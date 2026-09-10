-- ============================================================
-- ÓTICA COM IA — Schema V1 (multi-tenant, RLS)
-- Rodar UMA VEZ, num projeto Supabase novo, no SQL Editor.
-- Região recomendada do projeto: South America (São Paulo).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------
do $$ begin
  create type user_role          as enum ('proprietario','gerente','vendedor');
  create type lead_status         as enum ('novo','em_atendimento','agendado','compareceu','venda','perdido','reativacao');
  create type lead_temperature    as enum ('frio','morno','quente','muito_quente');
  create type appointment_status  as enum ('aguardando','confirmado','compareceu','faltou','cancelado');
  create type channel_type        as enum ('meta_ads','google_ads','whatsapp','indicacao','organico','outro');
  create type campaign_status     as enum ('ativa','pausada','encerrada');
  create type insight_severity    as enum ('info','atencao','critico');
  create type task_priority       as enum ('urgente','importante','oportunidade','followup');
  create type task_impact         as enum ('alto','medio','baixo');
exception when duplicate_object then null; end $$;

-- ---------- TENANT / CORE ----------
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists stores (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- pessoas que fazem LOGIN
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  store_id        uuid references stores(id) on delete set null,
  full_name       text not null default '',
  role            user_role not null default 'vendedor',
  avatar_url      text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- pessoas a quem se ATRIBUI leads (não precisam de login)
create table if not exists sellers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id        uuid references stores(id) on delete set null,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- MÍDIA ----------
create table if not exists campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  channel         channel_type not null default 'meta_ads',
  status          campaign_status not null default 'ativa',
  objective       text,
  daily_budget    numeric(12,2) not null default 0,
  total_spend     numeric(12,2) not null default 0,
  started_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists ad_sets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now()
);

create table if not exists ads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  ad_set_id       uuid references ad_sets(id) on delete set null,
  name            text not null,
  format          text,
  created_at      timestamptz not null default now()
);

create table if not exists creatives (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  ad_id           uuid references ads(id) on delete set null,
  name            text not null,
  type            text,
  created_at      timestamptz not null default now()
);

-- ---------- CATÁLOGO ----------
create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  category        text,
  created_at      timestamptz not null default now()
);

-- ---------- LEAD (ativo central) ----------
create table if not exists leads (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  store_id               uuid references stores(id) on delete set null,
  name                   text not null,
  phone                  text,
  whatsapp               text,
  channel                channel_type not null default 'meta_ads',
  source                 text,
  campaign_id            uuid references campaigns(id) on delete set null,
  ad_set_id              uuid references ad_sets(id) on delete set null,
  ad_id                  uuid references ads(id) on delete set null,
  creative_id            uuid references creatives(id) on delete set null,
  offer                  text,
  product_interest       text,
  assigned_seller_id     uuid references sellers(id) on delete set null,
  status                 lead_status not null default 'novo',
  temperature            lead_temperature not null default 'morno',
  lead_score             int not null default 0,
  first_response_seconds int,
  last_interaction_at     timestamptz,
  next_action            text,
  next_action_at         timestamptz,
  loss_reason            text,
  notes                  text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_leads_org on leads(organization_id);
create index if not exists idx_leads_status on leads(organization_id, status);
create index if not exists idx_leads_created on leads(organization_id, created_at);

-- linha do tempo do lead (componente Timeline)
create table if not exists lead_interactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  kind            text not null,
  description     text not null,
  actor_name      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_interactions_lead on lead_interactions(lead_id, occurred_at);

-- ---------- COMERCIAL ----------
create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id        uuid references stores(id) on delete set null,
  lead_id         uuid not null references leads(id) on delete cascade,
  seller_id       uuid references sellers(id) on delete set null,
  scheduled_at    timestamptz not null,
  status          appointment_status not null default 'aguardando',
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_appt_org_time on appointments(organization_id, scheduled_at);

create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  store_id        uuid references stores(id) on delete set null,
  lead_id         uuid references leads(id) on delete set null,
  seller_id       uuid references sellers(id) on delete set null,
  campaign_id     uuid references campaigns(id) on delete set null,
  ad_id           uuid references ads(id) on delete set null,
  total_amount    numeric(12,2) not null default 0,
  sold_at         timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_sales_org_time on sales(organization_id, sold_at);

create table if not exists sale_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sale_id         uuid not null references sales(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  description     text not null,
  quantity        int not null default 1,
  unit_amount     numeric(12,2) not null default 0
);

-- ---------- IA / TAREFAS ----------
create table if not exists ai_insights (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope           text not null,               -- home | funil | campanha | lead | agenda
  severity        insight_severity not null default 'info',
  title           text not null,
  body            text not null,
  action_label    text,
  action_target   text,
  created_at      timestamptz not null default now()
);

create table if not exists tasks (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  lead_id            uuid references leads(id) on delete set null,
  assigned_seller_id uuid references sellers(id) on delete set null,
  title              text not null,
  priority           task_priority not null default 'importante',
  impact             task_impact not null default 'medio',
  status             text not null default 'aberta',   -- aberta | concluida
  due_at             timestamptz,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- HELPERS DE AUTORIZAÇÃO
-- ============================================================
create or replace function auth_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid()
$$;

create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- cria profile automaticamente quando alguém se cadastra
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- Regra base: só enxergo linhas da MINHA organização.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'stores','sellers','campaigns','ad_sets','ads','creatives','products',
    'leads','lead_interactions','appointments','sales','sale_items','ai_insights','tasks'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists org_select on %I;', t);
    execute format('drop policy if exists org_write  on %I;', t);
    execute format($f$create policy org_select on %I for select
                     using (organization_id = auth_org_id());$f$, t);
    execute format($f$create policy org_write on %I for all
                     using (organization_id = auth_org_id())
                     with check (organization_id = auth_org_id());$f$, t);
  end loop;
end $$;

alter table organizations enable row level security;
drop policy if exists org_self on organizations;
create policy org_self on organizations for select using (id = auth_org_id());

alter table profiles enable row level security;
drop policy if exists profiles_read   on profiles;
drop policy if exists profiles_update  on profiles;
create policy profiles_read on profiles for select
  using (organization_id = auth_org_id() or id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid());

-- OBS (endurecer depois): política extra para VENDEDOR ver só os próprios leads.
-- create policy leads_seller_scope on leads for select using (
--   auth_role() <> 'vendedor'
--   or assigned_seller_id in (select seller_id from profiles_seller_link where profile_id = auth.uid())
-- );

-- ============================================================
-- SEMENTE (dados de demonstração — uma base única e consistente)
-- Ajuste números/nomes à vontade; mantenha os relacionamentos.
-- ============================================================
insert into organizations (id, name) values
  ('11111111-1111-1111-1111-111111111111','Ótica Visão')
on conflict do nothing;

insert into stores (id, organization_id, name, is_primary) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Unidade Centro', true)
on conflict do nothing;

insert into sellers (id, organization_id, store_id, name) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Gabriela'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Rafael'),
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Juliana'),
  ('a0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Marcos')
on conflict do nothing;

insert into products (id, organization_id, name, category) values
  ('b0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Lente Multifocal','lente'),
  ('b0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Óculos Completo','kit'),
  ('b0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Lente Antirreflexo','lente'),
  ('b0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Armação','armacao')
on conflict do nothing;

insert into campaigns (id, organization_id, name, channel, status, objective, daily_budget, total_spend, started_at) values
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Multifocal Setembro','meta_ads','ativa','leads', 60, 438, now() - interval '9 days'),
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Troca de Óculos','meta_ads','ativa','whatsapp', 40, 210, now() - interval '6 days')
on conflict do nothing;

insert into ad_sets (id, organization_id, campaign_id, name) values
  ('d0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','Público Frio 45+'),
  ('d0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002','Interesse Óculos')
on conflict do nothing;

insert into ads (id, organization_id, campaign_id, ad_set_id, name, format) values
  ('e0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Vídeo 01','video'),
  ('e0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Vídeo 02','video'),
  ('e0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Criativo 03','imagem'),
  ('e0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','Vídeo A','video'),
  ('e0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','Estático B','imagem')
on conflict do nothing;

-- ----- LEADS nomeados (jornadas específicas) -----
insert into leads (id, organization_id, store_id, name, phone, whatsapp, channel, campaign_id, ad_set_id, ad_id, offer, product_interest, assigned_seller_id, status, temperature, lead_score, first_response_seconds, last_interaction_at, next_action, next_action_at, created_at) values
  ('f0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Maria Silva','5511990000001','5511990000001','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','Multifocal + armação por R$899','Lente Multifocal','a0000000-0000-0000-0000-000000000001','venda','muito_quente', 92, 660, now() - interval '1 day', null, null, now() - interval '2 days'),
  ('f0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Carlos Souza','5511990000002','5511990000002','meta_ads','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000004',null,'Óculos Completo','a0000000-0000-0000-0000-000000000002','agendado','quente', 74, 900, now() - interval '3 hours','Confirmar presença', now() + interval '2 hours', now() - interval '1 day'),
  ('f0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Ana Paula','5511990000003','5511990000003','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003',null,'Lente Multifocal','a0000000-0000-0000-0000-000000000003','em_atendimento','morno', 55, 1200, now() - interval '1 day','Follow-up (orçamento enviado)', now(), now() - interval '1 day'),
  ('f0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','João Mendes','5511990000004','5511990000004','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',null,'Óculos Completo','a0000000-0000-0000-0000-000000000001','venda','quente', 80, 300, now() - interval '2 hours', null, null, now() - interval '5 hours'),
  ('f0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Carla Dias','5511990000005','5511990000005','indicacao', null, null, null, null,'Lente Antirreflexo','a0000000-0000-0000-0000-000000000004','venda','quente', 70, 420, now() - interval '3 hours', null, null, now() - interval '6 hours'),
  ('f0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Marcos Lima','5511990000006','5511990000006','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',null,'Lente Multifocal','a0000000-0000-0000-0000-000000000002','agendado','morno', 48, 1500, now() - interval '4 hours', null, null, now() - interval '7 hours'),
  ('f0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Júlia Rocha','5511990000007','5511990000007','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',null,'Óculos Completo','a0000000-0000-0000-0000-000000000003','agendado','morno', 45, 1800, now() - interval '5 hours','Confirmar horário 15:30', now(), now() - interval '8 hours'),
  ('f0000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Roberto Alves','5511990000008','5511990000008','meta_ads','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000004',null,'Óculos Completo','a0000000-0000-0000-0000-000000000001','agendado','quente', 68, 600, now() - interval '2 hours', null, null, now() - interval '6 hours'),
  ('f0000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Fernanda Costa','5511990000009','5511990000009','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',null,'Lente Multifocal', null,'novo','muito_quente', 88, null, now() - interval '18 minutes','Primeiro atendimento', now(), now() - interval '37 minutes'),
  ('f0000000-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Paulo Henrique','5511990000010','5511990000010','meta_ads','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000004',null,'Óculos Completo', null,'novo','muito_quente', 85, null, now() - interval '15 minutes','Primeiro atendimento', now(), now() - interval '22 minutes'),
  ('f0000000-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Beatriz Nunes','5511990000011','5511990000011','meta_ads','c0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003',null,'Lente Multifocal', null,'novo','morno', 40, null, now() - interval '12 minutes','Primeiro atendimento', now(), now() - interval '12 minutes'),
  ('f0000000-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Diego Martins','5511990000012','5511990000012','meta_ads','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000005',null,'Armação', null,'novo','morno', 38, null, now() - interval '8 minutes','Primeiro atendimento', now(), now() - interval '8 minutes')
on conflict do nothing;

-- ----- LEADS de volume (para os números de "hoje") -----
insert into leads (organization_id, store_id, name, phone, channel, campaign_id, ad_set_id, ad_id, assigned_seller_id, status, temperature, lead_score, last_interaction_at, created_at)
select
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'Lead ' || g,
  '55119900001' || lpad(g::text, 2, '0'),
  'meta_ads',
  case when g % 2 = 0 then 'c0000000-0000-0000-0000-000000000001' else 'c0000000-0000-0000-0000-000000000002' end::uuid,
  case when g % 2 = 0 then 'd0000000-0000-0000-0000-000000000001' else 'd0000000-0000-0000-0000-000000000002' end::uuid,
  case when g % 2 = 0 then 'e0000000-0000-0000-0000-000000000002' else 'e0000000-0000-0000-0000-000000000004' end::uuid,
  ('a0000000-0000-0000-0000-00000000000' || (1 + (g % 4)))::uuid,
  (array['em_atendimento','em_atendimento','agendado','compareceu','perdido'])[1 + (g % 5)]::lead_status,
  (array['frio','morno','morno','quente'])[1 + (g % 4)]::lead_temperature,
  30 + (g * 3) % 60,
  now() - (g || ' hours')::interval,
  now() - ((g * 37) || ' minutes')::interval
from generate_series(1, 8) g;

-- ----- APPOINTMENTS de hoje -----
insert into appointments (organization_id, store_id, lead_id, seller_id, scheduled_at, status, confirmed_at) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001', date_trunc('day', now()) + interval '10 hours','compareceu', now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000004', date_trunc('day', now()) + interval '11 hours 30 minutes','compareceu', now() - interval '6 hours'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000002', date_trunc('day', now()) + interval '14 hours','aguardando', null),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000003', date_trunc('day', now()) + interval '15 hours 30 minutes','aguardando', null),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002', date_trunc('day', now()) + interval '16 hours','confirmado', now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000001', date_trunc('day', now()) + interval '17 hours','confirmado', now() - interval '2 hours')
on conflict do nothing;

-- ----- SALES -----
-- Maria (ontem, atribui à campanha Multifocal Setembro)
insert into sales (id, organization_id, store_id, lead_id, seller_id, campaign_id, ad_id, total_amount, sold_at) values
  ('5a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002', 1480, now() - interval '1 day'),
-- Hoje: 3 vendas = R$4.280 (2 de campanha paga + 1 de indicação)
  ('5a000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001', 1300, date_trunc('day', now()) + interval '10 hours 30 minutes'),
  ('5a000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', 1980, date_trunc('day', now()) + interval '13 hours'),
  ('5a000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000004', null, null, 1000, date_trunc('day', now()) + interval '11 hours 45 minutes')
on conflict do nothing;

insert into sale_items (organization_id, sale_id, product_id, description, quantity, unit_amount) values
  ('11111111-1111-1111-1111-111111111111','5a000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Lente Multifocal', 1, 1480),
  ('11111111-1111-1111-1111-111111111111','5a000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','Óculos Completo', 1, 1300),
  ('11111111-1111-1111-1111-111111111111','5a000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','Lente Multifocal', 1, 1480),
  ('11111111-1111-1111-1111-111111111111','5a000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000004','Armação', 1, 500),
  ('11111111-1111-1111-1111-111111111111','5a000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000003','Lente Antirreflexo', 1, 1000)
on conflict do nothing;

-- ----- TIMELINE da Maria (componente Timeline) -----
insert into lead_interactions (organization_id, lead_id, occurred_at, kind, description, actor_name) values
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '0 minutes','lead_recebido','Lead recebido — Meta Ads / Multifocal Setembro / Vídeo 02','Sistema'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '1 minutes','mensagem_enviada','Primeiro contato automático enviado','Sistema'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '5 minutes','mensagem_recebida','Lead respondeu','Maria Silva'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '8 minutes','ia','IA identificou interesse em Multifocal','IA'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '11 minutes','atribuicao','Lead atribuído para Gabriela','Sistema'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '30 minutes','atendimento','Atendimento iniciado','Gabriela'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '2 days' + interval '106 minutes','agendamento','Agendamento realizado','Gabriela'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '1 day','comparecimento','Cliente compareceu','Gabriela'),
  ('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000001', now() - interval '1 day' + interval '49 minutes','venda','Venda realizada — R$1.480 — Lente Multifocal','Gabriela')
on conflict do nothing;

-- ----- INSIGHTS da IA (Home) -----
insert into ai_insights (organization_id, scope, severity, title, body, action_label, action_target) values
  ('11111111-1111-1111-1111-111111111111','home','atencao','Gargalo no primeiro atendimento',
   'O principal gargalo hoje está entre Lead e Atendimento. 22% dos leads ainda não receberam primeiro contato, e 2 deles estão classificados como muito quentes.',
   'Atender leads','/leads?filtro=sem-atendimento'),
  ('11111111-1111-1111-1111-111111111111','home','info','Multifocal Setembro é a de melhor qualidade comercial',
   'Apesar do CPL mais alto, os leads da campanha Multifocal Setembro convertem cerca de 3x mais em vendas do que a Troca de Óculos. Não recomendamos pausar pelo CPL.',
   'Analisar campanha','/campanhas/c0000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111','home','info','Resumo do dia',
   'Sua ótica recebeu 18 leads hoje, 14 foram atendidos, 6 agendamentos e 3 vendas (R$4.280). A ação mais importante agora é atender os leads quentes sem primeiro contato.',
   'Ver plano de ação','/plano-de-acao')
on conflict do nothing;

-- ----- TAREFAS (Plano de Ação) -----
insert into tasks (organization_id, title, priority, impact, status) values
  ('11111111-1111-1111-1111-111111111111','Atender 3 leads muito quentes sem primeiro contato','urgente','alto','aberta'),
  ('11111111-1111-1111-1111-111111111111','Confirmar 2 agendamentos ainda não confirmados','importante','medio','aberta'),
  ('11111111-1111-1111-1111-111111111111','Analisar a campanha Multifocal Setembro (ótima conversão comercial)','oportunidade','medio','aberta'),
  ('11111111-1111-1111-1111-111111111111','Fazer follow-up de 5 oportunidades sem interação há +24h','followup','medio','aberta')
on conflict do nothing;

-- ============================================================
-- APÓS CRIAR SEU LOGIN NO APP, rode isto (troque o e-mail):
-- ============================================================
-- update profiles set
--   organization_id = '11111111-1111-1111-1111-111111111111',
--   store_id        = '22222222-2222-2222-2222-222222222222',
--   role            = 'proprietario',
--   full_name       = 'Felipe'
-- where id = (select id from auth.users where email = 'SEU_EMAIL_AQUI');
