-- DrMan reviewed migration: persistent_support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('account','billing','upload','doctor','other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_admin','waiting_user','closed')),
  ai_enabled boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_updated_idx ON public.support_tickets(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_updated_idx ON public.support_tickets(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user','assistant','admin')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 7000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_created_idx ON public.support_ticket_messages(ticket_id,created_at,id);
CREATE TABLE IF NOT EXISTS public.support_ai_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '2 minutes')
);
CREATE INDEX IF NOT EXISTS support_ai_reservations_user_expiry_idx ON public.support_ai_reservations(user_id,expires_at);
CREATE INDEX IF NOT EXISTS support_ai_reservations_ticket_idx ON public.support_ai_reservations(ticket_id);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets,public.support_ticket_messages,public.support_ai_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.support_tickets,public.support_ticket_messages,public.support_ai_reservations TO service_role;

-- Pausing AI, closing a ticket, or answering as a human revokes the work that
-- was already in flight. Re-enabling later must not revive an older answer.
CREATE OR REPLACE FUNCTION public.revoke_support_ai_on_ticket_control()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT NEW.ai_enabled OR NEW.status='closed' THEN
    DELETE FROM public.support_ai_reservations WHERE ticket_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_support_ai_on_ticket_control() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_support_ai_on_ticket_control() TO service_role;
DROP TRIGGER IF EXISTS support_ai_control_revocation ON public.support_tickets;
CREATE TRIGGER support_ai_control_revocation AFTER UPDATE OF ai_enabled,status ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.revoke_support_ai_on_ticket_control();

CREATE OR REPLACE FUNCTION public.append_support_ticket_message(p_ticket_id uuid,p_user_id uuid,p_sender_type text,p_content text,p_reservation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.support_tickets; mid uuid;
BEGIN
  IF p_sender_type IS NULL OR p_sender_type NOT IN ('user','assistant','admin') OR p_content IS NULL OR char_length(trim(p_content)) NOT BETWEEN 1 AND 7000 THEN
    RAISE EXCEPTION 'INVALID_SUPPORT_MESSAGE';
  END IF;
  IF p_sender_type='assistant' THEN PERFORM 1 FROM public.users WHERE id=p_user_id AND status='active' FOR UPDATE; IF NOT FOUND THEN RETURN jsonb_build_object('saved',false); END IF; END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=t.user_id AND status='active') THEN RAISE EXCEPTION 'SUPPORT_TICKET_UNAVAILABLE'; END IF;
  IF p_sender_type IN ('user','assistant') AND t.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'SUPPORT_TICKET_FORBIDDEN'; END IF;
  IF p_sender_type='assistant' THEN
    IF NOT t.ai_enabled OR t.status='closed' THEN DELETE FROM public.support_ai_reservations WHERE id=p_reservation_id AND user_id=p_user_id; RETURN jsonb_build_object('saved',false,'human_takeover',true); END IF;
    IF p_reservation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.support_ai_reservations WHERE id=p_reservation_id AND user_id=p_user_id AND ticket_id=t.id AND expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('saved',false,'quota_expired',true); END IF;
  END IF;
  IF p_sender_type='user' AND t.status='closed' THEN RAISE EXCEPTION 'SUPPORT_TICKET_CLOSED'; END IF;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_type,content,created_at) VALUES(t.id,p_sender_type,trim(p_content),clock_timestamp()) RETURNING id INTO mid;
  UPDATE public.support_tickets SET updated_at=clock_timestamp(),
    status=CASE WHEN p_sender_type='user' THEN 'waiting_admin' ELSE 'waiting_user' END,
    ai_enabled=CASE WHEN p_sender_type='admin' THEN false ELSE ai_enabled END WHERE id=t.id;
  IF p_sender_type='assistant' THEN DELETE FROM public.support_ai_reservations WHERE id=p_reservation_id AND user_id=p_user_id; END IF;
  RETURN jsonb_build_object('saved',true,'message_id',mid);
END; $$;
REVOKE ALL ON FUNCTION public.append_support_ticket_message(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_support_ticket_message(uuid,uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_support_ticket(p_user_id uuid,p_title text,p_category text,p_content text,p_sender_type text,p_tags text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.support_tickets;
BEGIN
  IF p_sender_type IS NULL OR p_sender_type NOT IN ('user','admin') OR p_title IS NULL OR char_length(trim(p_title)) NOT BETWEEN 1 AND 160
    OR p_category IS NULL OR p_category NOT IN ('account','billing','upload','doctor','other') OR p_content IS NULL OR char_length(trim(p_content)) NOT BETWEEN 1 AND 2500 THEN RAISE EXCEPTION 'INVALID_SUPPORT_TICKET'; END IF;
  IF p_tags IS NULL OR cardinality(p_tags)>8 OR EXISTS(SELECT 1 FROM unnest(p_tags) tag WHERE tag IS NULL OR char_length(trim(tag)) NOT BETWEEN 1 AND 40) THEN RAISE EXCEPTION 'INVALID_SUPPORT_TAGS'; END IF;
  PERFORM 1 FROM public.users WHERE id=p_user_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPORT_USER_UNAVAILABLE'; END IF;
  INSERT INTO public.support_tickets(user_id,title,category,ai_enabled,status,tags,created_at,updated_at)
    VALUES(p_user_id,trim(p_title),p_category,p_sender_type='user',CASE WHEN p_sender_type='user' THEN 'waiting_admin' ELSE 'waiting_user' END,p_tags,clock_timestamp(),clock_timestamp())
    RETURNING * INTO t;
  INSERT INTO public.support_ticket_messages(ticket_id,sender_type,content,created_at) VALUES(t.id,p_sender_type,trim(p_content),clock_timestamp());
  RETURN to_jsonb(t);
END; $$;
REVOKE ALL ON FUNCTION public.create_support_ticket(uuid,text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid,text,text,text,text,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_support_ticket_user(p_ticket_id uuid,p_title text,p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_id uuid;
BEGIN
  IF p_title IS NULL OR char_length(trim(p_title)) NOT BETWEEN 1 AND 160
    OR p_body IS NULL OR char_length(trim(p_body)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'INVALID_SUPPORT_NOTIFICATION'; END IF;
  SELECT user_id INTO owner_id FROM public.support_tickets WHERE id=p_ticket_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Erasure freezes the account before cleaning notifications. Hold this lock
  -- until insertion commits, or return without a write for an inactive owner.
  PERFORM 1 FROM public.users WHERE id=owner_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.support_tickets WHERE id=p_ticket_id AND user_id=owner_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.notifications(user_id,type,title,body,action_url,source_type,source_id)
    VALUES(owner_id,'support_ticket',trim(p_title),trim(p_body),'/support?ticket='||p_ticket_id::text,'support_ticket',p_ticket_id);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.notify_support_ticket_user(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notify_support_ticket_user(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_support_ai_reply(p_user_id uuid,p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE u public.users; daily_limit integer; used bigint; rid uuid; day_start timestamptz; v_now timestamptz;
BEGIN
  SELECT * INTO u FROM public.users WHERE id=p_user_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false,'reason','inactive'); END IF;
  v_now:=clock_timestamp();
  day_start:=date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  PERFORM 1 FROM public.support_tickets WHERE id=p_ticket_id AND user_id=p_user_id AND ai_enabled AND status<>'closed' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false,'reason','human'); END IF;
  SELECT support_daily_limit INTO daily_limit FROM public.plans WHERE id=u.plan_id AND active AND (u.plan_expires_at IS NULL OR u.plan_expires_at>v_now);
  IF daily_limit IS NULL THEN SELECT support_daily_limit INTO daily_limit FROM public.plans WHERE slug='free' AND active LIMIT 1; END IF;
  IF daily_limit IS NULL OR daily_limit<1 THEN RETURN jsonb_build_object('reserved',false,'reason','quota'); END IF;
  DELETE FROM public.support_ai_reservations WHERE user_id=p_user_id AND expires_at<=v_now;
  SELECT (SELECT count(*) FROM public.support_ticket_messages m JOIN public.support_tickets t ON t.id=m.ticket_id WHERE t.user_id=p_user_id AND m.sender_type='assistant' AND m.created_at>=day_start)
    +(SELECT count(*) FROM public.support_messages WHERE user_id=p_user_id AND role='assistant' AND created_at>=day_start)
    +(SELECT count(*) FROM public.support_ai_reservations WHERE user_id=p_user_id AND expires_at>v_now) INTO used;
  IF used>=daily_limit THEN RETURN jsonb_build_object('reserved',false,'reason','quota'); END IF;
  INSERT INTO public.support_ai_reservations(user_id,ticket_id,expires_at) VALUES(p_user_id,p_ticket_id,v_now+interval '2 minutes') RETURNING id INTO rid;
  RETURN jsonb_build_object('reserved',true,'reservation_id',rid,'remaining_today',greatest(0,daily_limit-used-1));
END; $$;
REVOKE ALL ON FUNCTION public.reserve_support_ai_reply(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_support_ai_reply(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.release_support_ai_reservation(p_reservation_id uuid,p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ DELETE FROM public.support_ai_reservations WHERE id=p_reservation_id AND user_id=p_user_id; $$;
REVOKE ALL ON FUNCTION public.release_support_ai_reservation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_support_ai_reservation(uuid,uuid) TO service_role;
