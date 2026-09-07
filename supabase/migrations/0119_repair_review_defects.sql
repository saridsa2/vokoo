-- Repair the schema provenance and cohort rows exposed by the first care-path
-- deployment, and make a trigger that reaches no work unpublishable.

begin;

create or replace function public.translate_vokoo_clinical_description(p_text text)
returns text language sql immutable set search_path = public as $$
  select case p_text
    when 'CT 剂量体积指数。' then 'Computed tomography dose index by volume, in mGy.'
    when 'N 正常，L 偏低，H 偏高，A 异常。' then 'Interpretation: N normal, L low, H high, or A abnormal.'
    when 'SNOMED CT 给药途径代码：口服/静脉/肌注/皮下/吸入/舌下/直肠。' then 'SNOMED CT route codes for oral, intravenous, intramuscular, subcutaneous, inhaled, sublingual, and rectal administration.'
    when 'UCUM 单位，例如 mg、mL。' then 'UCUM unit, such as mg or mL.'
    when 'UCUM 单位（默认宽松模式）。如需严格控制，使用 UCUMUnitStrict。' then 'UCUM unit using the permissive default pattern. Use UCUMUnitStrict when a restricted unit set is required.'
    when 'UCUM 样式校验（允许常见 UCUM 字符集，避免空格）。' then 'Validates common UCUM-style unit characters and disallows spaces.'
    when '与 proband 的关系。可映射 HL7 v3 RoleCode。' then 'Relationship to the proband, mappable to an HL7 v3 RoleCode.'
    when '个人健康数据核心 Schema，参考 HL7 FHIR Patient 资源的最小可用字段。' then 'Core personal health record using a minimal practical subset of the HL7 FHIR Patient resource.'
    when '主要遗传/慢性疾病，建议使用 SNOMED CT 或 ICD-10。' then 'Significant inherited or chronic conditions, preferably coded with SNOMED CT or ICD-10.'
    when '住址信息。' then 'Postal addresses for the person.'
    when '全局唯一 ID（UUID/ULID）。' then 'Globally unique UUID or ULID.'
    when '关联健康档案 Person.id' then 'Person.id of the associated health record.'
    when '出生日期（ISO 8601）。' then 'Date of birth in ISO 8601 format.'
    when '剂量长度乘积。' then 'Dose-length product, in mGy cm.'
    when '外部标识（例如 MRN、国家 ID）。' then 'External identifiers such as a medical record number or national identifier.'
    when '姓名，至少包含一个条目。' then 'Names for the person, with at least one entry.'
    when '家庭健康树 Schema，记录家庭成员关系与遗传相关疾病。' then 'Family health tree recording relationships and potentially inherited conditions.'
    when '家系中被调查/就诊的核心个体 ID。' then 'Identifier of the proband, the person at the centre of the family history.'
    when '已知疾病/诊断，建议使用 SNOMED CT 或 ICD-10。' then 'Known conditions and diagnoses, preferably coded with SNOMED CT or ICD-10.'
    when '常用 UCUM 单位子集（严格模式），覆盖血常规/生化/免疫/肿瘤标志物等场景。' then 'Strict subset of common UCUM units covering blood counts, biochemistry, immunology, and tumour-marker tests.'
    when '常用影像模式：CT/MR/US/XR/PET。' then 'Common imaging modalities: CT, MR, ultrasound, radiography, and PET.'
    when '常用缩写。' then 'Common route abbreviations.'
    when '常见标本：全血、血清、血浆、尿液。' then 'Common specimen types: whole blood, serum, plasma, and urine.'
    when '影像所见。' then 'Imaging findings.'
    when '影像报告结构化 Schema，参考 DICOM 影像模式代码和 SNOMED CT 部位编码。' then 'Structured imaging report using DICOM modality codes and SNOMED CT body-site codes.'
    when '性别，沿用 FHIR 枚举。' then 'Administrative gender using the FHIR value set.'
    when '检验结果值：支持数值(Quantity)、定性(字符串)、或编码值(CodeableConcept)。' then 'Laboratory result as a numeric quantity, qualitative string, or coded concept.'
    when '生化检验报告结构化 Schema，参考 LOINC 与 UCUM 作为编码与单位体系。' then 'Structured laboratory report using LOINC for test codes and UCUM for units.'
    when '用药记录 Schema，参考 RxNorm 药物编码与常见给药途径。' then 'Medication record using RxNorm drug codes and common administration routes.'
    when '给药频次，如 QD、BID、TID。' then 'Administration frequency, such as QD, BID, or TID.'
    when '缩略图、报告 PDF 等' then 'Attachment type, such as a thumbnail or report PDF.'
    when '联系方式（电话/邮箱）。' then 'Contact details such as telephone numbers and email addresses.'
    when '血型，如 A+, O-。' then 'Blood group, such as A+ or O-.'
    when '诊断结论/印象。' then 'Diagnostic conclusion or impression.'
    when '语言偏好，IETF BCP-47 语言标签。' then 'Preferred languages expressed as IETF BCP 47 language tags.'
    when '资源类型，固定为 Person。' then 'Resource type, always Person.'
    when '过敏史。' then 'Known allergies.'
    when '首诊/负责医生或机构 ID。' then 'Identifier of the person''s primary clinician or care organization.'
    else p_text
  end
$$;

create or replace function public.translate_vokoo_clinical_schema(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(jsonb_object_agg(key,
        case when key = 'description' and jsonb_typeof(value) = 'string'
          then to_jsonb(public.translate_vokoo_clinical_description(value #>> '{}'))
          else public.translate_vokoo_clinical_schema(value)
        end), '{}'::jsonb)
        into v_result
        from jsonb_each(p_value);
    when 'array' then
      select coalesce(jsonb_agg(public.translate_vokoo_clinical_schema(value) order by ordinal), '[]'::jsonb)
        into v_result
        from jsonb_array_elements(p_value) with ordinality item(value, ordinal);
    else v_result := p_value;
  end case;
  return v_result;
end;
$$;

create or replace function public.refresh_vokoo_clinical_schemas(p_org_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_changed integer; v_previous_push_setting text;
begin
  v_previous_push_setting := current_setting('vokoo.pushing', true);
  perform set_config('vokoo.pushing', 'on', true);
  update public.structured_outputs
     set name = replace(name, 'WellAll', 'VoKoo'),
         description = replace(replace(description, 'WellAll', 'VoKoo'), 'https://wellall.health/schemas/', 'urn:vokoo:clinical:schema:'),
         schema = public.translate_vokoo_clinical_schema(
           replace(schema::text, 'https://wellall.health/schemas/', 'urn:vokoo:clinical:schema:')::jsonb
         ),
         updated_at = now()
   where origin = 'vendor' and (p_org_id is null or org_id = p_org_id);
  get diagnostics v_changed = row_count;

  update public.structured_outputs set schema = jsonb_set(schema, '{title}', to_jsonb(replace(schema->>'title', 'WellAll', 'VoKoo')))
   where origin = 'vendor' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,maritalStatus,description}', to_jsonb('Marital status, optionally coded with the HL7 v3 MaritalStatus value set.'::text), true)
   where name = 'VoKoo Health Core' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,results,items,properties,code,description}', to_jsonb('LOINC code identifying the laboratory test.'::text), true)
   where name = 'VoKoo Lab Report' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,bodySite,description}', to_jsonb('Examined body site, preferably coded with a SNOMED CT anatomical structure code.'::text), true)
   where name = 'VoKoo Imaging Report' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,medication,description}', to_jsonb('Medication code, preferably from RxNorm.'::text), true)
   where name = 'VoKoo Medication Record' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,form,description}', to_jsonb('Dose form, such as tablet or capsule.'::text), true)
   where name = 'VoKoo Medication Record' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,route,description}', to_jsonb('Administration route, such as oral (PO) or intravenous (IV).'::text), true)
   where name = 'VoKoo Medication Record' and (p_org_id is null or org_id = p_org_id);
  update public.structured_outputs set schema = jsonb_set(schema, '{properties,indication,description}', to_jsonb('Clinical indication for the medication.'::text), true)
   where name = 'VoKoo Medication Record' and (p_org_id is null or org_id = p_org_id);
  perform set_config('vokoo.pushing', coalesce(v_previous_push_setting, ''), true);
  return v_changed;
exception when others then
  perform set_config('vokoo.pushing', coalesce(v_previous_push_setting, ''), true);
  raise;
end;
$$;

revoke all on function public.translate_vokoo_clinical_description(text) from public;
revoke all on function public.translate_vokoo_clinical_schema(jsonb) from public;
revoke all on function public.refresh_vokoo_clinical_schemas(uuid) from public;
grant execute on function public.refresh_vokoo_clinical_schemas(uuid) to service_role;

select public.refresh_vokoo_clinical_schemas();

create or replace function public.seed_clinical_schemas_on_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_clinical_schemas(new.id);
  perform public.refresh_vokoo_clinical_schemas(new.id);
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.cohorts c
    join public.flows f on f.id = c.flow_id
    where f.family <> 'care_path'
      and exists (select 1 from public.cohort_patients cp where cp.cohort_id = c.id)
  ) then
    raise exception 'an enrolled cohort points at a non-care-path flow and needs manual reassignment';
  end if;

  delete from public.cohorts c
   using public.flows f
   where c.flow_id = f.id
     and f.family <> 'care_path'
     and not exists (select 1 from public.cohort_patients cp where cp.cohort_id = c.id);
end;
$$;

create or replace function public.validate_flow_release(
  p_org_id uuid, p_family text, p_graph jsonb
)
returns void language plpgsql stable set search_path = public as $$
declare v_node jsonb; v_schema text; v_target text;
begin
  if exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
    left join public.catalogue_node_types t on t.id = n->>'implementation'
    where t.id is null or not (p_family = any(t.families))
  ) then raise exception 'the flow contains a node outside its family' using errcode = 'P0004'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' like 'trigger.%'
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_graph->'transitions', '[]'::jsonb)) t
          where t->>'from' = n->>'id'
       )
  ) then raise exception 'every trigger needs a route to work' using errcode = 'P0004'; end if;

  if p_family = 'care_path' then perform public.validate_care_path_release(p_graph); end if;
  if p_family = 'integration' then
    if (select count(*) from jsonb_array_elements(p_graph->'nodes') n where n->>'implementation' = 'trigger.integration_invoked') <> 1
       or exists (select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'implementation' like 'trigger.%' and n->>'implementation' <> 'trigger.integration_invoked') then
      raise exception 'an integration needs exactly one Integration invoked trigger' using errcode = 'P0004';
    end if;
    select n->'config'->>'input_schema_id' into v_schema from jsonb_array_elements(p_graph->'nodes') n where n->>'implementation' = 'trigger.integration_invoked';
    if coalesce(v_schema, '') = '' or not exists (
      select 1 from public.structured_outputs where id = v_schema::uuid and org_id = p_org_id and enabled
    ) then raise exception 'the integration trigger needs an enabled input schema in this workspace' using errcode = 'P0004'; end if;
  end if;

  for v_node in select n from jsonb_array_elements(p_graph->'nodes') n where n->>'implementation' = 'integration.invoke'
  loop
    v_target := v_node->'config'->>'target_flow_id';
    if coalesce(v_target, '') = '' or not exists (
      select 1 from public.flows where id = v_target::uuid and org_id = p_org_id and family = 'integration' and status = 'published'
    ) then raise exception 'Invoke integration needs a published integration in this workspace' using errcode = 'P0004'; end if;
  end loop;
end;
$$;

revoke all on function public.validate_flow_release(uuid,text,jsonb) from public;
grant execute on function public.validate_flow_release(uuid,text,jsonb) to authenticated;

commit;
