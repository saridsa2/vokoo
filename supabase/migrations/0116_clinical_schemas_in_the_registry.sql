-- The WellAlly clinical schemas, in the schema registry.
--
-- A person, a lab report, an imaging report, a medication record and a family
-- history. They come from `vendor/vokoo-clinical-schemas`, whose Health JSON spec
-- pins the code systems this product has to speak: SNOMED CT for conditions and
-- routes, LOINC for lab codes, RxNorm for drugs, UCUM for units.
--
-- ## Why the registry rather than an import
--
-- A schema is wanted by more than one thing. A tool declares what it takes, an
-- intelligence node fills one in, an integration trigger accepts one. Written
-- separately they drift, and the drift is invisible until a payload is rejected
-- by something nobody told. That argument is already in this repo, as the
-- reason `structured_outputs` exists at all — it applies to these too.
--
-- ## Why they are inlined
--
-- Upstream these reference each other by URI:
--
--     "$ref": "https://wellall.health/schemas/common/v0.1.0#/$defs/CodeableConcept"
--
-- Nothing downstream follows that. A model resolves no references in a tool's
-- input schema, the console's editor reads `properties` and knows nothing of
-- `$defs`, and `compileSchema` in the SDK has no `$ref` at all. So they arrive
-- flattened, by `npm run schemas:inline`, and `npm run schemas:check` fails when
-- the artifact and the vendored source disagree.
--
-- ## Why a third origin
--
-- `console` is written here and may be unlocked here. `push` came from a
-- repository and may only be released at the source. These are neither: their
-- authority is a vendored contract, so `vendor` is refused unlocking with a
-- message that says where they actually come from.
--
-- The ids are derived from the organisation and the kind, so re-running this
-- inserts nothing twice.

begin;

alter table public.structured_outputs
  drop constraint if exists structured_outputs_origin_check;
alter table public.structured_outputs
  add constraint structured_outputs_origin_check
  check (origin in ('console', 'push', 'vendor'));

comment on column public.structured_outputs.origin is
  'console = written here. push = arrived from a repository via the CLI. vendor = a schema this product ships, editable nowhere.';

-- The lock refused unlocking for 'push' only. A vendor row unlocked here could
-- then be edited, and the next `schemas:inline` would not put it back — the
-- registry would quietly hold a clinical contract that no longer matches the
-- one the bridge validates against.
create or replace function public.refuse_locked_edit()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('vokoo.pushing', true), '') = 'on' then
    return new;
  end if;

  if to_jsonb(new) - 'locked' - 'updated_at' is not distinct from to_jsonb(old) - 'locked' - 'updated_at' then
    if new.locked is distinct from old.locked then
      if old.origin = 'push' then
        raise exception
          '% came from a repository — unlock it at the source with locked: false, or delete the file to take it over here',
          coalesce(new.name, old.name)
          using errcode = 'P0005';
      elsif old.origin = 'vendor' then
        raise exception
          '% is a clinical schema this product ships — it is not edited here. Copy it to a new schema if you need a variant.',
          coalesce(new.name, old.name)
          using errcode = 'P0005';
      end if;
    end if;
    return new;
  end if;

  if old.locked then
    raise exception
      '% is authored elsewhere and locked — edit it where it is written, or push it with locked: false',
      coalesce(new.name, old.name)
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

-- Seeded per organisation because `org_id` is `not null`: making it nullable to
-- hold one global copy would mean every RLS policy on this table growing an
-- `or org_id is null` branch, and a policy with a hole in it is how the last two
-- security faults here happened.
create or replace function public.seed_clinical_schemas(p_org_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_added integer := 0;
begin
  insert into public.structured_outputs (id, org_id, name, description, schema, origin, locked)
  select
    -- Deterministic, so re-running adds nothing: same org and kind, same row.
    md5(p_org_id::text || ':vokoo:' || k.kind)::uuid,
    p_org_id,
    k.name,
    'Clinical contract from ' || k.source,
    k.schema,
    'vendor',
    true
  from (values
    ('health', 'WellAll Health Core', 'https://wellall.health/schemas/health/v0.1.0', '{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://wellall.health/schemas/health/v0.1.0","title":"WellAll Health Core","description":"个人健康数据核心 Schema，参考 HL7 FHIR Patient 资源的最小可用字段。","type":"object","required":["id","name","birthDate"],"properties":{"id":{"type":"string","description":"全局唯一 ID（UUID/ULID）。"},"resourceType":{"type":"string","const":"Person","description":"资源类型，固定为 Person。"},"identifier":{"type":"array","description":"外部标识（例如 MRN、国家 ID）。","items":{"type":"object","required":["system","value"],"properties":{"system":{"type":"string","format":"uri"},"value":{"type":"string"},"type":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"period":{"type":"object","properties":{"start":{"type":"string","format":"date"},"end":{"type":"string","format":"date"}}}}}},"name":{"type":"array","minItems":1,"items":{"type":"object","required":["family","given"],"properties":{"use":{"type":"string","enum":["official","usual","nickname","anonymous","old","maiden"]},"family":{"type":"string"},"given":{"type":"array","items":{"type":"string"},"minItems":1},"prefix":{"type":"array","items":{"type":"string"}},"suffix":{"type":"array","items":{"type":"string"}}}},"description":"姓名，至少包含一个条目。"},"birthDate":{"type":"string","format":"date","description":"出生日期（ISO 8601）。"},"gender":{"type":"string","enum":["male","female","other","unknown"],"description":"性别，沿用 FHIR 枚举。"},"telecom":{"type":"array","items":{"type":"object","required":["system","value"],"properties":{"system":{"type":"string","enum":["phone","email"]},"value":{"type":"string"},"use":{"type":"string","enum":["home","work","mobile"]}}},"description":"联系方式（电话/邮箱）。"},"address":{"type":"array","items":{"type":"object","properties":{"line":{"type":"array","items":{"type":"string"}},"city":{"type":"string"},"state":{"type":"string"},"postalCode":{"type":"string"},"country":{"type":"string"}}},"description":"住址信息。"},"maritalStatus":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"language":{"type":"array","items":{"type":"string"},"description":"语言偏好，IETF BCP-47 语言标签。"},"clinicalSummary":{"type":"object","properties":{"conditions":{"type":"array","items":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"description":"已知疾病/诊断，建议使用 SNOMED CT 或 ICD-10。"},"allergies":{"type":"array","items":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"description":"过敏史。"},"bloodType":{"type":"string","description":"血型，如 A+, O-。"},"primaryCareProvider":{"type":"string","description":"首诊/负责医生或机构 ID。"}}}}}'::jsonb),
    ('lab-report', 'WellAll Lab Report', 'https://wellall.health/schemas/lab-report/v0.1.0', '{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://wellall.health/schemas/lab-report/v0.1.0","title":"WellAll Lab Report","description":"生化检验报告结构化 Schema，参考 LOINC 与 UCUM 作为编码与单位体系。","type":"object","required":["id","patientId","issuedAt","results"],"properties":{"id":{"type":"string"},"patientId":{"type":"string","description":"关联健康档案 Person.id"},"issuedAt":{"type":"string","format":"date-time"},"facility":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"}}},"panel":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"specimen":{"type":"object","properties":{"type":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string","enum":["BLD","SER","PLAS","UR"],"description":"常见标本：全血、血清、血浆、尿液。"},"display":{"type":"string"}}},"collectedAt":{"type":"string","format":"date-time"}}},"results":{"type":"array","minItems":1,"items":{"type":"object","required":["code","value"],"properties":{"code":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"value":{"description":"检验结果值：支持数值(Quantity)、定性(字符串)、或编码值(CodeableConcept)。","oneOf":[{"type":"object","required":["value","unit"],"properties":{"value":{"type":"number"},"unit":{"anyOf":[{"type":"string","enum":["mg","g","g/L","g/dL","mg/dL","mg/L","mmol/L","nmol/L","umol/L","pmol/L","ng/mL","ng/dL","ng/L","ug/dL","pg/mL","%","U/L","U/mL","IU/L","IU/mL","kU/L","k[IU]/L","mU/L","mIU/L","m[IU]/L","mIU/mL","m[IU]/mL","uIU/mL","10*3/uL","10*6/uL","10*9/L","10*12/L","cells/uL","mEq/L","mmHg","mm/h","mL","uL","L","kat/L","mmol/mol","{titer}"],"description":"常用 UCUM 单位子集（严格模式），覆盖血常规/生化/免疫/肿瘤标志物等场景。"},{"type":"string","pattern":"^[A-Za-z0-9%\\[\\]{}().*/^+-]+$","description":"UCUM 样式校验（允许常见 UCUM 字符集，避免空格）。"}],"description":"UCUM 单位（默认宽松模式）。如需严格控制，使用 UCUMUnitStrict。"}}},{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},{"type":"string","minLength":1}]},"referenceRange":{"type":"object","properties":{"low":{"type":"object","required":["value","unit"],"properties":{"value":{"type":"number"},"unit":{"anyOf":[{"type":"string","enum":["mg","g","g/L","g/dL","mg/dL","mg/L","mmol/L","nmol/L","umol/L","pmol/L","ng/mL","ng/dL","ng/L","ug/dL","pg/mL","%","U/L","U/mL","IU/L","IU/mL","kU/L","k[IU]/L","mU/L","mIU/L","m[IU]/L","mIU/mL","m[IU]/mL","uIU/mL","10*3/uL","10*6/uL","10*9/L","10*12/L","cells/uL","mEq/L","mmHg","mm/h","mL","uL","L","kat/L","mmol/mol","{titer}"],"description":"常用 UCUM 单位子集（严格模式），覆盖血常规/生化/免疫/肿瘤标志物等场景。"},{"type":"string","pattern":"^[A-Za-z0-9%\\[\\]{}().*/^+-]+$","description":"UCUM 样式校验（允许常见 UCUM 字符集，避免空格）。"}],"description":"UCUM 单位（默认宽松模式）。如需严格控制，使用 UCUMUnitStrict。"}}},"high":{"type":"object","required":["value","unit"],"properties":{"value":{"type":"number"},"unit":{"anyOf":[{"type":"string","enum":["mg","g","g/L","g/dL","mg/dL","mg/L","mmol/L","nmol/L","umol/L","pmol/L","ng/mL","ng/dL","ng/L","ug/dL","pg/mL","%","U/L","U/mL","IU/L","IU/mL","kU/L","k[IU]/L","mU/L","mIU/L","m[IU]/L","mIU/mL","m[IU]/mL","uIU/mL","10*3/uL","10*6/uL","10*9/L","10*12/L","cells/uL","mEq/L","mmHg","mm/h","mL","uL","L","kat/L","mmol/mol","{titer}"],"description":"常用 UCUM 单位子集（严格模式），覆盖血常规/生化/免疫/肿瘤标志物等场景。"},{"type":"string","pattern":"^[A-Za-z0-9%\\[\\]{}().*/^+-]+$","description":"UCUM 样式校验（允许常见 UCUM 字符集，避免空格）。"}],"description":"UCUM 单位（默认宽松模式）。如需严格控制，使用 UCUMUnitStrict。"}}},"text":{"type":"string"}}},"interpretation":{"type":"string","enum":["N","L","H","A"],"description":"N 正常，L 偏低，H 偏高，A 异常。"},"method":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}}}}}}}'::jsonb),
    ('imaging-report', 'WellAll Imaging Report', 'https://wellall.health/schemas/imaging-report/v0.1.0', '{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://wellall.health/schemas/imaging-report/v0.1.0","title":"WellAll Imaging Report","description":"影像报告结构化 Schema，参考 DICOM 影像模式代码和 SNOMED CT 部位编码。","type":"object","required":["id","patientId","modality","bodySite","reportedAt"],"properties":{"id":{"type":"string"},"patientId":{"type":"string"},"studyInstanceUid":{"type":"string","description":"DICOM Study Instance UID。"},"modality":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string","enum":["CT","MR","US","XR","PT"],"description":"常用影像模式：CT/MR/US/XR/PET。"},"display":{"type":"string"}}},"bodySite":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"reportedAt":{"type":"string","format":"date-time"},"performer":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"role":{"type":"string"}}},"findings":{"type":"array","items":{"type":"string"},"description":"影像所见。"},"impression":{"type":"string","description":"诊断结论/印象。"},"radiationDose":{"type":"object","properties":{"ctdiVol_mGy":{"type":"number","description":"CT 剂量体积指数。"},"dlp_mGy_cm":{"type":"number","description":"剂量长度乘积。"}}},"attachments":{"type":"array","items":{"type":"object","properties":{"url":{"type":"string","format":"uri"},"type":{"type":"string","description":"缩略图、报告 PDF 等"}}}}}}'::jsonb),
    ('medication', 'WellAll Medication Record', 'https://wellall.health/schemas/medication/v0.1.0', '{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://wellall.health/schemas/medication/v0.1.0","title":"WellAll Medication Record","description":"用药记录 Schema，参考 RxNorm 药物编码与常见给药途径。","type":"object","required":["id","patientId","medication","dosage","route","startDate"],"properties":{"id":{"type":"string"},"patientId":{"type":"string"},"medication":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"form":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"route":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"anyOf":[{"type":"string","enum":["PO","IV","IM","SC","INH","SL","PR"],"description":"常用缩写。"},{"type":"string","enum":["26643006","47625008","78421000","34206005","447694001","37839007","37161004"],"description":"SNOMED CT 给药途径代码：口服/静脉/肌注/皮下/吸入/舌下/直肠。"},{"type":"string","pattern":"^[0-9]{3,18}$"}]},"display":{"type":"string"}}},"dosage":{"type":"object","required":["value","unit"],"properties":{"value":{"type":"number"},"unit":{"type":"string","description":"UCUM 单位，例如 mg、mL。"}}},"frequency":{"type":"string","description":"给药频次，如 QD、BID、TID。"},"durationDays":{"type":"integer","minimum":1},"startDate":{"type":"string","format":"date"},"endDate":{"type":"string","format":"date"},"indication":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"instructions":{"type":"string"}}}'::jsonb),
    ('family-health', 'WellAll Family Health Tree', 'https://wellall.health/schemas/family-health/v0.1.0', '{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://wellall.health/schemas/family-health/v0.1.0","title":"WellAll Family Health Tree","description":"家庭健康树 Schema，记录家庭成员关系与遗传相关疾病。","type":"object","required":["probandId","members"],"properties":{"probandId":{"type":"string","description":"家系中被调查/就诊的核心个体 ID。"},"members":{"type":"array","minItems":1,"items":{"type":"object","required":["id","relationToProband"],"properties":{"id":{"type":"string"},"relationToProband":{"type":"string","enum":["self","mother","father","sibling","child","grandparent","grandchild","aunt","uncle","cousin","other"],"description":"与 proband 的关系。可映射 HL7 v3 RoleCode。"},"sex":{"type":"string","enum":["male","female","other","unknown"]},"birthYear":{"type":"integer","minimum":1900,"maximum":2100},"deceased":{"type":"boolean"},"conditions":{"type":"array","items":{"type":"object","required":["coding"],"properties":{"coding":{"type":"array","items":{"type":"object","required":["system","code"],"properties":{"system":{"type":"string","format":"uri"},"code":{"type":"string"},"display":{"type":"string"}}},"minItems":1},"text":{"type":"string"}}},"description":"主要遗传/慢性疾病，建议使用 SNOMED CT 或 ICD-10。"}}}}}}'::jsonb)
  ) as k(kind, name, source, schema)
  on conflict (id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public.seed_clinical_schemas(uuid) from public;
grant execute on function public.seed_clinical_schemas(uuid) to service_role;

-- Every organisation that exists now.
select public.seed_clinical_schemas(id) from public.organizations;

-- And every one made later. The trigger runs as the definer of the function it
-- calls, which is why that function is service_role only rather than open.
create or replace function public.seed_clinical_schemas_on_new_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_clinical_schemas(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_clinical_schemas on public.organizations;
create trigger organizations_seed_clinical_schemas
  after insert on public.organizations
  for each row execute function public.seed_clinical_schemas_on_new_org();

commit;
