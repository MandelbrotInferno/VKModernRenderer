#version 460


layout (location=0) in vec2 lv_uv;

layout(location = 0) out vec4 lv_finalColor;



layout(set = 0, binding = 0) uniform UniformBuffer
{

	mat4   m_inMtx;
	mat4   m_viewMatrix;
	vec4   m_cameraPos;
    vec4   m_time;
    vec4   m_pointLightCubeIntensity;

}lv_cameraUniform;


struct Light
{
	vec4 m_position;
	vec4 m_color;

	float m_linear;
	float m_quadratic;
	float m_radius;
	float m_pad;
};


uint m_totalNumLights = 1;
const float PI = 3.14159265359;



layout(set = 0, binding = 1) readonly buffer LightData {Light lights[];} lv_lights;


layout(set = 0, binding = 2) uniform sampler2D lv_gbufferPos;
layout(set = 0, binding = 3) uniform sampler2D lv_gbufferNormal;
layout(set = 0, binding = 4) uniform sampler2D lv_gbufferAlbedoSpec;
layout(set = 0, binding = 5) uniform sampler2D lv_gbufferTangent;
layout(set = 0, binding = 6) uniform sampler2D lv_gbufferNormalVertex;
layout(set = 0, binding = 7) uniform sampler2D lv_occlusionFactor;
layout(set = 0, binding = 8) uniform sampler2D lv_gbufferMetallic;
layout(set = 0, binding = 9) uniform samplerCube  lv_depthMapLight;

layout(set = 0,binding = 10) uniform  UniformBuffer2 { 

	mat4 m_viewMatrixSun;
	mat4 m_orthoMatrixSun;
	vec4 m_posSun;

} ubo;

layout(set = 0, binding = 11) uniform sampler2D lv_depth;



vec3 sampleOffsetDirections[27] = vec3[]
(
   vec3( 1,  1,  1), vec3( 1, -1,  1), vec3(-1, -1,  1), vec3(-1,  1,  1), 
   vec3( 1,  1, -1), vec3( 1, -1, -1), vec3(-1, -1, -1), vec3(-1,  1, -1),
   vec3( 1,  1,  0), vec3( 1, -1,  0), vec3(-1, -1,  0), vec3(-1,  1,  0),
   vec3( 1,  0,  1), vec3(-1,  0,  1), vec3( 1,  0, -1), vec3(-1,  0, -1),
   vec3( 0,  1,  1), vec3( 0, -1,  1), vec3( 0, -1, -1), vec3( 0,  1, -1),
   vec3(-1.f, -1.f, -1.f), vec3(-1.f, 1.f, 1.f), vec3(1.f, 1.f, -1.f),
   vec3(1.f, -1.f, 1.f), vec3( 1,  2,  0), vec3(-1, -2,  0), vec3( 2,  1,  0)
); 






float ShadowCalculation(vec3 lv_worldPos, vec3 lv_normal, vec3 lv_lightPos)
{
    //vec3 lv_lightPos = ubo.m_posSun.xyz;

    vec3 lv_dirVector = lv_worldPos - lv_lightPos;

    float lv_depthFragToLight = length(lv_dirVector);



    float shadow = 0.0;
    float bias   = max(0.05 * (1.0 - dot(lv_normal, lv_dirVector)), 0.005);
    int samples  = 27;
    float viewDistance = length(lv_cameraUniform.m_cameraPos.xyz - lv_worldPos);
    float diskRadius = (1.0 + (viewDistance / 100)) / 25.0;
    for(int i = 0; i < samples; ++i)
    {
        float closestDepth = texture(lv_depthMapLight, lv_dirVector + sampleOffsetDirections[i] * diskRadius).r;
        closestDepth *= 145;   // undo mapping [0;1]
        if(lv_depthFragToLight - bias > closestDepth)
            shadow += 1.0;
    }
    shadow /= float(samples); 

    
    
    return shadow;
}



vec3 NormalSampleToWorldSpace(vec3 l_sampledNormal, vec3 l_normalVertex, vec3 l_tangent)
{
    vec3 lv_normalT = 2.f * l_sampledNormal - 1.f;

    vec3 N = l_normalVertex;
    vec3 T = normalize(l_tangent - dot(l_tangent, N)*N);
    vec3 B = cross(N, T);

    mat3 TBN = mat3(T, B, N);

    return TBN*lv_normalT;
    
}



float DistributionGGX(vec3 N, vec3 H, float roughness)
{
    float a = roughness*roughness;
    float a2 = a*a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH*NdotH;

    float nom   = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return nom / (denom+0.008f);
}
// ----------------------------------------------------------------------------
float GeometrySchlickGGX(float NdotV, float roughness)
{
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;

    float nom   = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return nom / (denom +0.008f);
}
// ----------------------------------------------------------------------------
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness)
{
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = GeometrySchlickGGX(NdotV, roughness);
    float ggx1 = GeometrySchlickGGX(NdotL, roughness);

    return ggx1 * ggx2;
}
// ----------------------------------------------------------------------------
vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
// ----------------------------------------------------------------------------



float heaviside( float v ) {
    if ( v > 0.0 ) return 1.0;
    else return 0.0;
}



void main()
{

    float lv_occlusion = texture(lv_occlusionFactor ,lv_uv).r;
    float lv_metallic = texture(lv_gbufferMetallic ,lv_uv).g;
    float lv_roughness = texture(lv_gbufferMetallic ,lv_uv).r;
    vec3 lv_normal = NormalSampleToWorldSpace(texture(lv_gbufferNormal, lv_uv).rgb, texture(lv_gbufferNormalVertex, lv_uv).rgb, texture(lv_gbufferTangent, lv_uv).rgb);
    vec4 lv_albedo = texture(lv_gbufferAlbedoSpec, lv_uv);
    
    

	vec4 lv_worldPos = vec4(texture(lv_gbufferPos, lv_uv).xyz, 1.f);
    vec4 lv_viewPos = lv_cameraUniform.m_viewMatrix * lv_worldPos;
    vec3 lv_dir = normalize(lv_cameraUniform.m_cameraPos.xyz - lv_worldPos.xyz);

    vec3 F0 = vec3(0.04); 
    F0 = mix(F0, lv_albedo.rgb, lv_metallic);


    float lv_shadow = ShadowCalculation(lv_worldPos.xyz, lv_normal, lv_lights.lights[0].m_position.xyz);

    vec3 lv_lightning = lv_albedo.rgb * lv_occlusion * 0.005f;

    vec3 Lo = vec3(0.0f);
	for(uint i = 0; i < m_totalNumLights; ++i) {
        
        vec3 lv_lightPos = lv_lights.lights[i].m_position.xyz;
        vec3 L = normalize(lv_lightPos - lv_worldPos.xyz);
        vec3 H = normalize(lv_dir + L);




        float distance = length(lv_lightPos - lv_worldPos.xyz);
        float attenuation = 1.0 / distance*distance;
        vec3 radiance = vec3(1.f, 1.f, 1.f) * 0.00002f * lv_cameraUniform.m_pointLightCubeIntensity.x * attenuation;

        // Cook-Torrance BRDF
        float NDF = DistributionGGX(lv_normal, H, lv_roughness);   
        float G   = GeometrySmith(lv_normal, lv_dir, L, lv_roughness);      
        vec3 F    = fresnelSchlick(max(dot(H, lv_dir), 0.0), F0);
           
        vec3 numerator    = NDF * G * F; 
        float denominator = 4.0 * max(dot(lv_normal, lv_dir), 0.0) * max(dot(lv_normal, L), 0.0) + 0.0001; // + 0.0001 to prevent divide by zero
        vec3 specular = numerator / denominator;
        
        vec3 kS = F;
        
        vec3 kD = vec3(1.0) - kS;
        
        kD *= 1.0 - lv_metallic;	  

        float NdotL = max(dot(lv_normal, L), 0.0);        

        Lo += (kD * lv_albedo.rgb / PI + specular) * radiance * NdotL;  // note that we already multiplied the BRDF by the Fresnel (kS) so we won't multiply by kS again

	}




    //lv_finalColor = vec4(lv_lightning, 1.f);
   // lv_lightning += (lv_diffuse + specular)*lv_albedo.rgb;

    //lv_lightning = vec3(1.f) - exp(-lv_lightning*2.5f);


    //lv_lightning /= (lv_lightning + vec3(1.f));

   //lv_finalColor.rgb = pow(lv_lightning, vec3(1.f/2.2f));

   lv_lightning += (1.f - lv_shadow) * Lo;
   //lv_lightning += Lo;
   lv_finalColor.rgb = lv_lightning;
   lv_finalColor.a = lv_albedo.a;

}