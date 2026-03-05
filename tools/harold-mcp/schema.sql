-- ============================================================
-- Harold CRM — Supabase Schema
-- Run this once in the Supabase SQL Editor after creating your project.
-- Requires Postgres 14+ (gen_random_uuid() is built-in).
-- ============================================================

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    'member'  -- promote specific users to 'admin' manually after signup
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================
-- 2. SHARED UTILITY FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. CONTACTS (core CRM table)
-- ============================================================
-- Customize the category CHECK constraint to match your use case.
-- Common categories: investor, partner, customer, vendor, team, other

CREATE TABLE public.contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Core fields
  name TEXT NOT NULL,
  org TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'cold', 'archived')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  location TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  notes TEXT DEFAULT '',

  -- Relationship warmth (useful for outreach tracking)
  warmth TEXT DEFAULT '' CHECK (warmth IN ('', 'Hot', 'Warm', 'Lukewarm', 'Cold')),

  -- Pipeline tracking (populated by pipeline_stages workflow)
  pipeline TEXT,
  pipeline_stage TEXT,
  stage_entered_at TIMESTAMPTZ,

  -- Metadata
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_contacts_category ON public.contacts(category);
CREATE INDEX idx_contacts_status ON public.contacts(status);
CREATE INDEX idx_contacts_priority ON public.contacts(priority);
CREATE INDEX idx_contacts_name ON public.contacts(name);
CREATE INDEX idx_contacts_org ON public.contacts(org);
CREATE INDEX idx_contacts_pipeline ON public.contacts(pipeline);
CREATE INDEX idx_contacts_pipeline_stage ON public.contacts(pipeline, pipeline_stage);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

-- ============================================================
-- 4. AUDIT LOG
-- ============================================================

CREATE TABLE public.audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'status_change', 'note_added', 'stage_change')),
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_contact ON public.audit_log(contact_id);
CREATE INDEX idx_audit_user ON public.audit_log(user_id);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);

-- Auto-log contact changes
CREATE OR REPLACE FUNCTION public.log_contact_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (contact_id, user_id, action, new_value)
    VALUES (NEW.id, NEW.created_by, 'create', NEW.name || ' (' || NEW.org || ')');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'update', 'name', OLD.name, NEW.name);
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'status_change', 'status', OLD.status, NEW.status);
    END IF;
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'note_added', 'notes', OLD.notes, NEW.notes);
    END IF;
    IF OLD.priority IS DISTINCT FROM NEW.priority THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'update', 'priority', OLD.priority, NEW.priority);
    END IF;
    IF OLD.warmth IS DISTINCT FROM NEW.warmth THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'update', 'warmth', OLD.warmth, NEW.warmth);
    END IF;
    IF OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage THEN
      INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      VALUES (NEW.id, NEW.updated_by, 'stage_change', 'pipeline_stage',
              COALESCE(OLD.pipeline_stage, ''), COALESCE(NEW.pipeline_stage, ''));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (contact_id, user_id, action, old_value)
    VALUES (OLD.id, OLD.updated_by, 'delete', OLD.name || ' (' || OLD.org || ')');
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER contact_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE PROCEDURE public.log_contact_change();

-- ============================================================
-- 5. INTERACTIONS (communication timeline)
-- ============================================================

CREATE TABLE public.interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'linkedin', 'other')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_interactions_contact ON public.interactions(contact_id);
CREATE INDEX idx_interactions_user ON public.interactions(user_id);
CREATE INDEX idx_interactions_occurred ON public.interactions(occurred_at DESC);
CREATE INDEX idx_interactions_type ON public.interactions(type);

CREATE TRIGGER interactions_updated_at
  BEFORE UPDATE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Audit log entry on interaction created
CREATE OR REPLACE FUNCTION public.log_interaction_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (contact_id, user_id, action, field_changed, new_value)
  VALUES (
    NEW.contact_id, NEW.user_id, 'update', 'interaction',
    NEW.type || ': ' || COALESCE(NULLIF(NEW.subject, ''), LEFT(NEW.body, 80))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_interaction_created
  AFTER INSERT ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.log_interaction_created();

-- ============================================================
-- 6. TASKS (follow-ups and to-dos tied to contacts)
-- ============================================================

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id),
  created_by UUID REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_contact ON public.tasks(contact_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_due ON public.tasks(due_date);
CREATE INDEX idx_tasks_priority ON public.tasks(priority);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-set completed_at when task is marked complete
CREATE OR REPLACE FUNCTION public.set_task_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.completed_at = now();
  ELSIF NEW.status != 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_completed_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_task_completed_at();

-- ============================================================
-- 7. CONTACT CATEGORIES (multi-category junction table)
-- ============================================================

CREATE TABLE public.contact_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contact_id, category_name)
);

CREATE INDEX idx_contact_categories_contact ON public.contact_categories(contact_id);
CREATE INDEX idx_contact_categories_category ON public.contact_categories(category_name);

-- ============================================================
-- 8. PIPELINE STAGES (stage definitions per pipeline)
-- ============================================================

CREATE TABLE public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INT NOT NULL,
  description TEXT DEFAULT '',
  default_cadence TEXT DEFAULT '',  -- weekly | biweekly | monthly | quarterly
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pipeline, stage_name),
  UNIQUE(pipeline, stage_order)
);

CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages(pipeline);

-- ============================================================
-- 9. STAGE CHANGES (history of every stage transition)
-- ============================================================

CREATE TABLE public.stage_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID REFERENCES public.profiles(id),
  notes TEXT DEFAULT '',
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stage_changes_contact ON public.stage_changes(contact_id);
CREATE INDEX idx_stage_changes_pipeline ON public.stage_changes(pipeline);
CREATE INDEX idx_stage_changes_changed_at ON public.stage_changes(changed_at DESC);

-- ============================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contacts viewable by authenticated" ON public.contacts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Contacts insertable by authenticated" ON public.contacts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Contacts updatable by authenticated" ON public.contacts FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Contacts deletable by admins" ON public.contacts FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit log viewable by authenticated" ON public.audit_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Audit log insertable by system" ON public.audit_log FOR INSERT WITH CHECK (true);

ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Interactions viewable by authenticated" ON public.interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Interactions insertable by authenticated" ON public.interactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Interactions updatable by authenticated" ON public.interactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Interactions deletable by authenticated" ON public.interactions FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tasks viewable by authenticated" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tasks insertable by authenticated" ON public.tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Tasks updatable by authenticated" ON public.tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Tasks deletable by authenticated" ON public.tasks FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

ALTER TABLE public.contact_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories viewable by authenticated" ON public.contact_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Categories insertable by authenticated" ON public.contact_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Categories deletable by authenticated" ON public.contact_categories FOR DELETE TO authenticated USING (true);

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pipeline stages viewable by authenticated" ON public.pipeline_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pipeline stages insertable by authenticated" ON public.pipeline_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Pipeline stages updatable by authenticated" ON public.pipeline_stages FOR UPDATE TO authenticated USING (true);

ALTER TABLE public.stage_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stage changes viewable by authenticated" ON public.stage_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Stage changes insertable by authenticated" ON public.stage_changes FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- 11. REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.interactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_changes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;

-- ============================================================
-- 12. SEED: DEFAULT PIPELINE STAGES
-- ============================================================
-- Customize these pipelines to match your relationship types.
-- Delete pipelines you don't need. Add new ones with the same pattern.

-- Investor pipeline
INSERT INTO public.pipeline_stages (pipeline, stage_name, stage_order, description, default_cadence) VALUES
  ('investor', 'Prospect',          1, 'Identified as potential investor',          'monthly'),
  ('investor', 'Outreach',          2, 'Initial outreach sent',                     'weekly'),
  ('investor', 'Meeting Scheduled', 3, 'First meeting booked',                      'weekly'),
  ('investor', 'Due Diligence',     4, 'Investor reviewing materials',              'biweekly'),
  ('investor', 'Term Sheet',        5, 'Term sheet issued or under review',         'weekly'),
  ('investor', 'Committed',         6, 'Verbal or written commitment received',     'biweekly'),
  ('investor', 'Closed',            7, 'Investment closed and funds received',      'quarterly'),
  ('investor', 'Passed',            8, 'Investor passed or declined',               'quarterly');

-- Partner pipeline
INSERT INTO public.pipeline_stages (pipeline, stage_name, stage_order, description, default_cadence) VALUES
  ('partner', 'Identified',  1, 'Potential partner identified',                    'monthly'),
  ('partner', 'Exploring',   2, 'Exploratory conversations underway',               'biweekly'),
  ('partner', 'Negotiating', 3, 'Terms or scope being negotiated',                  'weekly'),
  ('partner', 'Active',      4, 'Partnership is active and producing value',        'monthly'),
  ('partner', 'Inactive',    5, 'Partnership ended or paused',                      'quarterly');

-- Customer pipeline (example — delete if not needed)
INSERT INTO public.pipeline_stages (pipeline, stage_name, stage_order, description, default_cadence) VALUES
  ('customer', 'Lead',       1, 'Potential customer identified',                    'weekly'),
  ('customer', 'Qualified',  2, 'Lead qualified as a real opportunity',             'weekly'),
  ('customer', 'Proposal',   3, 'Proposal or demo delivered',                       'weekly'),
  ('customer', 'Negotiating',4, 'Negotiating terms or contract',                    'weekly'),
  ('customer', 'Closed Won', 5, 'Deal closed, customer active',                     'monthly'),
  ('customer', 'Closed Lost',6, 'Deal lost or contact declined',                    'quarterly');
