--
-- PostgreSQL database dump
--

\restrict NccOvwHfteJdxHfKlzxNgcSYNKizs8G9d4obdIQEn5FghhCTRdpfyvJFVvGX7AZ

-- Dumped from database version 18.4 (Ubuntu 18.4-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ClinicalUrgency; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."ClinicalUrgency" AS ENUM (
    'ROUTINE',
    'PRIORITY',
    'URGENT',
    'EMERGENCY'
);


ALTER TYPE public."ClinicalUrgency" OWNER TO vsms_app;

--
-- Name: DocumentType; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."DocumentType" AS ENUM (
    'REFERRAL_PDF',
    'CLINICAL_SUMMARY_PDF'
);


ALTER TYPE public."DocumentType" OWNER TO vsms_app;

--
-- Name: EventAuditAction; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."EventAuditAction" AS ENUM (
    'CREATED',
    'UPDATED',
    'PUBLISHED',
    'STARTED',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."EventAuditAction" OWNER TO vsms_app;

--
-- Name: EventRegistrationStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."EventRegistrationStatus" AS ENUM (
    'SIGNED_UP',
    'CHECKED_IN',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."EventRegistrationStatus" OWNER TO vsms_app;

--
-- Name: EventStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."EventStatus" AS ENUM (
    'DRAFT',
    'PUBLISHED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."EventStatus" OWNER TO vsms_app;

--
-- Name: NotificationChannel; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."NotificationChannel" AS ENUM (
    'EMAIL'
);


ALTER TYPE public."NotificationChannel" OWNER TO vsms_app;

--
-- Name: NotificationDeliveryStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."NotificationDeliveryStatus" AS ENUM (
    'QUEUED',
    'SENDING',
    'DELIVERED',
    'FAILED',
    'BOUNCED',
    'CANCELLED'
);


ALTER TYPE public."NotificationDeliveryStatus" OWNER TO vsms_app;

--
-- Name: ReferralStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."ReferralStatus" AS ENUM (
    'DRAFT',
    'ISSUED',
    'SENT',
    'ACKNOWLEDGED',
    'CANCELLED'
);


ALTER TYPE public."ReferralStatus" OWNER TO vsms_app;

--
-- Name: ReviewOutcome; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."ReviewOutcome" AS ENUM (
    'COMPLETE',
    'MONITOR',
    'REFER',
    'URGENT_ESCALATION'
);


ALTER TYPE public."ReviewOutcome" OWNER TO vsms_app;

--
-- Name: ShiftStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."ShiftStatus" AS ENUM (
    'PLANNED',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."ShiftStatus" OWNER TO vsms_app;

--
-- Name: StaffAssignmentRole; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."StaffAssignmentRole" AS ENUM (
    'EVENT_MANAGER',
    'REGISTRATION',
    'SCREENER',
    'REVIEWER',
    'SUPPORT'
);


ALTER TYPE public."StaffAssignmentRole" OWNER TO vsms_app;

--
-- Name: StaffAssignmentStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."StaffAssignmentStatus" AS ENUM (
    'ASSIGNED',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."StaffAssignmentStatus" OWNER TO vsms_app;

--
-- Name: SyncActionStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."SyncActionStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'APPLIED',
    'CONFLICT',
    'FAILED'
);


ALTER TYPE public."SyncActionStatus" OWNER TO vsms_app;

--
-- Name: SyncOperation; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."SyncOperation" AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE'
);


ALTER TYPE public."SyncOperation" OWNER TO vsms_app;

--
-- Name: SystemRole; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."SystemRole" AS ENUM (
    'ADMIN',
    'EVENT_MANAGER',
    'STAFF'
);


ALTER TYPE public."SystemRole" OWNER TO vsms_app;

--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: vsms_app
--

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);


ALTER TYPE public."UserStatus" OWNER TO vsms_app;

--
-- Name: reject_event_audit_mutation(); Type: FUNCTION; Schema: public; Owner: vsms_app
--

CREATE FUNCTION public.reject_event_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'event audit logs are append-only' USING ERRCODE = '55000';
END;
$$;


ALTER FUNCTION public.reject_event_audit_mutation() OWNER TO vsms_app;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO vsms_app;

--
-- Name: document_artifacts; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.document_artifacts (
    document_id uuid NOT NULL,
    review_id uuid NOT NULL,
    referral_id uuid,
    document_type public."DocumentType" NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    storage_key text NOT NULL,
    content_hash character(64) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    generated_by_user_id uuid NOT NULL,
    generated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) with time zone
);


ALTER TABLE public.document_artifacts OWNER TO vsms_app;

--
-- Name: event_audit_logs; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.event_audit_logs (
    event_audit_log_id uuid NOT NULL,
    event_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action public."EventAuditAction" NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb,
    correlation_id uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.event_audit_logs OWNER TO vsms_app;

--
-- Name: event_days; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.event_days (
    event_day_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    date date NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT event_days_range_check CHECK ((starts_at < ends_at))
);


ALTER TABLE public.event_days OWNER TO vsms_app;

--
-- Name: event_registrations; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.event_registrations (
    registration_id uuid NOT NULL,
    event_id uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status public."EventRegistrationStatus" DEFAULT 'SIGNED_UP'::public."EventRegistrationStatus" NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.event_registrations OWNER TO vsms_app;

--
-- Name: event_station_availabilities; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.event_station_availabilities (
    event_station_availability_id uuid DEFAULT gen_random_uuid() CONSTRAINT event_station_availabilitie_event_station_availability_not_null NOT NULL,
    event_station_id uuid NOT NULL,
    event_day_id uuid NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    starts_at timestamp(3) with time zone,
    ends_at timestamp(3) with time zone,
    capacity integer NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT event_station_availabilities_capacity_check CHECK (((capacity >= 1) AND (capacity <= 100000))),
    CONSTRAINT event_station_availabilities_range_check CHECK ((((is_available = false) AND (starts_at IS NULL) AND (ends_at IS NULL)) OR ((is_available = true) AND (starts_at IS NOT NULL) AND (ends_at IS NOT NULL) AND (starts_at < ends_at))))
);


ALTER TABLE public.event_station_availabilities OWNER TO vsms_app;

--
-- Name: event_stations; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.event_stations (
    event_station_id uuid NOT NULL,
    event_id uuid NOT NULL,
    station_template_id uuid NOT NULL,
    template_version integer NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    station_order integer NOT NULL,
    capacity integer NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT event_stations_capacity_check CHECK (((capacity >= 1) AND (capacity <= 1000))),
    CONSTRAINT event_stations_order_check CHECK (((station_order >= 1) AND (station_order <= 51))),
    CONSTRAINT event_stations_template_version_check CHECK ((template_version > 0))
);


ALTER TABLE public.event_stations OWNER TO vsms_app;

--
-- Name: events; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.events (
    event_id uuid NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    venue character varying(255) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    capacity integer NOT NULL,
    status public."EventStatus" DEFAULT 'DRAFT'::public."EventStatus" NOT NULL,
    created_by_user_id uuid NOT NULL,
    cancelled_by_user_id uuid,
    cancelled_at timestamp(3) with time zone,
    cancellation_reason text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    timezone character varying(100) DEFAULT 'UTC'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    banner_key character varying(50) DEFAULT 'COMMUNITY_SCREENING'::character varying NOT NULL,
    artwork_data_url text,
    address character varying(500),
    postal_code character varying(6),
    latitude double precision,
    longitude double precision,
    location_provider character varying(20),
    location_reference character varying(255),
    expected_attendance integer,
    create_idempotency_key character varying(100),
    create_payload_hash character(64),
    CONSTRAINT events_artwork_data_url_check CHECK (((artwork_data_url IS NULL) OR ((char_length(artwork_data_url) <= 180000) AND (artwork_data_url ~ '^data:image/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'::text)))),
    CONSTRAINT events_banner_key_check CHECK (((banner_key)::text = ANY ((ARRAY['COMMUNITY_SCREENING'::character varying, 'LIBRARY_SCREENING'::character varying, 'EVENT_OPERATIONS'::character varying])::text[]))),
    CONSTRAINT events_cancellation_consistency_check CHECK ((((status = 'CANCELLED'::public."EventStatus") AND (cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL) AND ((char_length(btrim(cancellation_reason)) >= 10) AND (char_length(btrim(cancellation_reason)) <= 1000))) OR ((status <> 'CANCELLED'::public."EventStatus") AND (cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancellation_reason IS NULL)))),
    CONSTRAINT events_capacity_check CHECK (((capacity >= 1) AND (capacity <= 100000))),
    CONSTRAINT events_expected_attendance_check CHECK (((expected_attendance IS NULL) OR ((expected_attendance >= 1) AND (expected_attendance <= 1000000)))),
    CONSTRAINT events_location_pair_check CHECK ((((latitude IS NULL) AND (longitude IS NULL)) OR (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))))),
    CONSTRAINT events_location_provider_check CHECK (((location_provider IS NULL) OR ((location_provider)::text = ANY ((ARRAY['ONEMAP'::character varying, 'MANUAL'::character varying])::text[])))),
    CONSTRAINT events_time_range_check CHECK ((ends_at > starts_at)),
    CONSTRAINT events_version_check CHECK ((version > 0))
);


ALTER TABLE public.events OWNER TO vsms_app;

--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.notification_deliveries (
    notification_delivery_id uuid NOT NULL,
    referral_id uuid,
    document_id uuid,
    channel public."NotificationChannel" DEFAULT 'EMAIL'::public."NotificationChannel" NOT NULL,
    recipient_address_encrypted bytea NOT NULL,
    template_key character varying(100) NOT NULL,
    provider_message_id character varying(255),
    status public."NotificationDeliveryStatus" DEFAULT 'QUEUED'::public."NotificationDeliveryStatus" NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp(3) with time zone,
    delivered_at timestamp(3) with time zone,
    failure_code character varying(100),
    failure_message text,
    idempotency_key character varying(255) NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.notification_deliveries OWNER TO vsms_app;

--
-- Name: participant_event_registrations; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.participant_event_registrations (
    registration_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.participant_event_registrations OWNER TO vsms_app;

--
-- Name: participants; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.participants (
    participant_id uuid NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.participants OWNER TO vsms_app;

--
-- Name: qr_code_passes; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.qr_code_passes (
    qr_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    token character varying(255) NOT NULL,
    issued_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    revoked_at timestamp(3) with time zone,
    revoked_by_user_id uuid,
    revoked_reason character varying(255),
    CONSTRAINT qr_code_passes_expiry_check CHECK ((expires_at > issued_at))
);


ALTER TABLE public.qr_code_passes OWNER TO vsms_app;

--
-- Name: referrals; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.referrals (
    referral_id uuid NOT NULL,
    review_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    destination_name character varying(200) NOT NULL,
    destination_email character varying(255),
    reason text NOT NULL,
    instructions text,
    urgency public."ClinicalUrgency" NOT NULL,
    status public."ReferralStatus" DEFAULT 'DRAFT'::public."ReferralStatus" NOT NULL,
    referred_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.referrals OWNER TO vsms_app;

--
-- Name: refresh_sessions; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.refresh_sessions (
    refresh_session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    last_used_at timestamp(3) with time zone,
    rotated_at timestamp(3) with time zone,
    revoked_at timestamp(3) with time zone,
    reuse_detected_at timestamp(3) with time zone,
    replaced_by_session_id uuid,
    user_agent_hash character(64),
    network_hint character varying(64),
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT refresh_sessions_expiry_check CHECK ((expires_at > created_at))
);


ALTER TABLE public.refresh_sessions OWNER TO vsms_app;

--
-- Name: reviews; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.reviews (
    review_id uuid NOT NULL,
    registration_id uuid NOT NULL,
    reviewed_by_user_id uuid NOT NULL,
    outcome public."ReviewOutcome" NOT NULL,
    urgency public."ClinicalUrgency" DEFAULT 'ROUTINE'::public."ClinicalUrgency" NOT NULL,
    clinical_summary text NOT NULL,
    recommendations text,
    reviewed_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    supersedes_review_id uuid,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.reviews OWNER TO vsms_app;

--
-- Name: shifts; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.shifts (
    shift_id uuid NOT NULL,
    event_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    required_staff integer DEFAULT 1 NOT NULL,
    status public."ShiftStatus" DEFAULT 'PLANNED'::public."ShiftStatus" NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT shifts_required_staff_check CHECK (((required_staff >= 1) AND (required_staff <= 1000))),
    CONSTRAINT shifts_time_range_check CHECK ((ends_at > starts_at))
);


ALTER TABLE public.shifts OWNER TO vsms_app;

--
-- Name: staff_assignments; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.staff_assignments (
    staff_assignment_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_station_id uuid,
    assignment_role public."StaffAssignmentRole" NOT NULL,
    status public."StaffAssignmentStatus" DEFAULT 'ASSIGNED'::public."StaffAssignmentStatus" NOT NULL,
    assigned_by_user_id uuid NOT NULL,
    notes text,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.staff_assignments OWNER TO vsms_app;

--
-- Name: station_templates; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.station_templates (
    station_template_id uuid NOT NULL,
    template_key character varying(80) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    default_capacity integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT station_templates_capacity_check CHECK (((default_capacity >= 1) AND (default_capacity <= 1000))),
    CONSTRAINT station_templates_version_check CHECK ((version > 0))
);


ALTER TABLE public.station_templates OWNER TO vsms_app;

--
-- Name: sync_actions; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.sync_actions (
    sync_action_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    actor_user_id uuid,
    registration_id uuid,
    entity_type character varying(100) NOT NULL,
    entity_id uuid NOT NULL,
    operation public."SyncOperation" NOT NULL,
    base_version integer,
    payload jsonb NOT NULL,
    status public."SyncActionStatus" DEFAULT 'PENDING'::public."SyncActionStatus" NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    error_code character varying(100),
    error_details jsonb,
    received_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.sync_actions OWNER TO vsms_app;

--
-- Name: users; Type: TABLE; Schema: public; Owner: vsms_app
--

CREATE TABLE public.users (
    user_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    system_role public."SystemRole" DEFAULT 'STAFF'::public."SystemRole" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp(3) with time zone,
    last_login_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    username character varying(100) NOT NULL,
    CONSTRAINT users_email_normalized_check CHECK (((email)::text = lower(btrim((email)::text)))),
    CONSTRAINT users_failed_login_attempts_check CHECK ((failed_login_attempts >= 0)),
    CONSTRAINT users_username_normalized_check CHECK ((((username)::text = lower(btrim((username)::text))) AND ((username)::text ~ '^[a-z0-9][a-z0-9._-]{2,99}$'::text)))
);


ALTER TABLE public.users OWNER TO vsms_app;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
8a1b51a3-80dd-4416-b2f0-9adcf128d65e	17c6064bfe41dc1c44491df27265225b1244dc33ed22aeaa2131f612ee1e61da	2026-07-24 19:49:04.238439+08	20260716023847_init	\N	\N	2026-07-24 19:49:04.207752+08	1
1a8e859e-a758-4807-b73a-68613c962c38	532401b3cd9db36f9e5f733d60f07c900af5954e59c669ff6c12cd1c75481f53	\N	20260726101255_update_event_schema	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260726101255_update_event_schema\n\nDatabase error code: 42710\n\nDatabase error:\nERROR: type "EventStatus" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42710), message: "type \\"EventStatus\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("typecmds.c"), line: Some(1211), routine: Some("DefineEnum") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260726101255_update_event_schema"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260726101255_update_event_schema"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	\N	2026-07-30 17:07:30.917333+08	0
5d147b69-a3b7-4f1a-af41-a839c22f927e	eeca1e2f859a5f7d1bf72ac03d73a5f6f180b9c8a1daa7491ea3aa5ff51f5137	2026-07-24 19:49:04.254012+08	20260717065318_rename_user_table	\N	\N	2026-07-24 19:49:04.240407+08	1
0baff83b-203e-487f-bd7a-e97631093957	b528de9f511df98337af4a5e29fffe10e25b1fd6e99b1ef3150495eed3b853af	2026-07-24 19:49:04.273416+08	20260719140307_delete_all_tables	\N	\N	2026-07-24 19:49:04.255914+08	1
1e164803-6d72-40bc-a23f-0c91929c93ab	b41dacd0fee7696790aa1a237b631885e27e588fbd88d731bb8cb2fcc6044fcb	2026-07-24 19:49:04.296906+08	20260722112442_add_event_clinical_notification_sync_tables	\N	\N	2026-07-24 19:49:04.275508+08	1
8836461d-8cf4-4b87-9192-91024d660c0d	415ef23106423c2c7e212887adc1de4eb15c464e4580db8dc8e8513e70e718df	2026-07-24 19:49:04.315582+08	20260722121312_event_lifecycle_security	\N	\N	2026-07-24 19:49:04.298923+08	1
79f16c47-d018-4b17-bd2d-169a9a5f5897	aff30cb62f837eb7c67aabd29874b22a141880b7ad9fdfa8c7b2346fe8cce3f5	2026-07-24 19:49:04.323888+08	20260722131000_add_temporary_username	\N	\N	2026-07-24 19:49:04.317423+08	1
c4071303-e7cd-49af-a866-2b73f354a435	67b3265734d0898e58278dc63ddd20ac5f7c43acc04af1f37907a0d5f85e1a2e	2026-07-24 19:49:04.332328+08	20260722193000_add_event_banner	\N	\N	2026-07-24 19:49:04.325767+08	1
4caaaff7-b140-4ac8-a3fd-1f074240e119	8935367ab6d14cd15eb5344941fd166f97fcef1b28f554e248af067bae09c2a7	2026-07-24 19:49:04.339364+08	20260722203000_add_event_custom_artwork	\N	\N	2026-07-24 19:49:04.33431+08	1
a1f0551b-24ae-4848-aed6-3f0769394076	173c6a07bda314c6469a0e2060c193a05e8af36f3ee1e6293273585fdd3d16c1	2026-07-24 19:49:04.347387+08	20260723130000_add_event_registrations	\N	\N	2026-07-24 19:49:04.341009+08	1
8dbc6f3c-7791-4133-a195-78b0ff205964	f96e5a8e12a4508c788ed007cd8b2f54f85a519417042dbca2082b150be2d0c3	2026-07-24 19:49:04.355057+08	20260723164500_add_event_registration_status	\N	\N	2026-07-24 19:49:04.349001+08	1
97b1c284-7ce7-4379-b984-802cc738d174	bbc7b6e8140c8bb1d251bd146acc9403b4d0300c793842460e5ecab46b95bd6e	2026-07-24 19:49:04.367028+08	20260724100000_add_participant_qr_passes	\N	\N	2026-07-24 19:49:04.356831+08	1
36f9a7fb-bdb9-438b-89e5-4e7982bcf401	a161dabb8ffcdd37a6b77769f83f7e69139739d2299fe94f1e70b7c5291865d7	2026-07-24 19:49:04.378954+08	20260724143000_add_event_station_operations	\N	\N	2026-07-24 19:49:04.368501+08	1
76cb249b-b5a6-41da-a51d-e30206c8dee2	1b954fde0e20945bc507544d0b06bbd577c346a7c8a6bfd06c77b24226070656	2026-07-24 22:45:15.048055+08	20260724213000_add_event_planning_location	\N	\N	2026-07-24 22:45:15.024602+08	1
\.


--
-- Data for Name: document_artifacts; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.document_artifacts (document_id, review_id, referral_id, document_type, version, storage_key, content_hash, mime_type, size_bytes, generated_by_user_id, generated_at, expires_at) FROM stdin;
\.


--
-- Data for Name: event_audit_logs; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.event_audit_logs (event_audit_log_id, event_id, actor_user_id, action, before_snapshot, after_snapshot, correlation_id, created_at) FROM stdin;
30000000-0000-4000-8000-000000000001	20000000-0000-4000-8000-000000000001	10000000-0000-4000-8000-000000000002	CREATED	\N	{"name": "Northside Community Screening", "status": "PUBLISHED", "version": 1, "capacity": 180}	40000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.155+08
30000000-0000-4000-8000-000000000002	20000000-0000-4000-8000-000000000002	10000000-0000-4000-8000-000000000002	CREATED	\N	{"name": "Riverside Vision Day", "status": "DRAFT", "version": 1, "capacity": 120}	40000000-0000-4000-8000-000000000002	2026-07-24 19:49:13.202+08
30000000-0000-4000-8000-000000000003	20000000-0000-4000-8000-000000000003	10000000-0000-4000-8000-000000000002	CREATED	\N	{"name": "Central Library Screening", "status": "IN_PROGRESS", "version": 1, "capacity": 200}	40000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.23+08
30000000-0000-4000-8000-000000000004	20000000-0000-4000-8000-000000000004	10000000-0000-4000-8000-000000000002	CREATED	\N	{"name": "West End Community Check", "status": "COMPLETED", "version": 1, "capacity": 150}	40000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.291+08
30000000-0000-4000-8000-000000000005	20000000-0000-4000-8000-000000000005	10000000-0000-4000-8000-000000000002	CREATED	\N	{"name": "Harbour Family Screening", "status": "CANCELLED", "version": 1, "capacity": 100}	40000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.367+08
\.


--
-- Data for Name: event_days; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.event_days (event_day_id, event_id, date, starts_at, ends_at, created_at, updated_at) FROM stdin;
333a2f14-521e-444b-8b9e-10376f6e4ff9	20000000-0000-4000-8000-000000000001	2026-08-12	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.264+08
740b8cd4-eb32-431c-969b-1b3697ec0a38	20000000-0000-4000-8000-000000000002	2026-09-05	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.314+08
af859782-581f-4438-9e97-3f08a0bfa5fe	20000000-0000-4000-8000-000000000003	2026-07-22	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.347+08
c8525713-faf4-4048-827f-b587bddfb719	20000000-0000-4000-8000-000000000004	2026-06-18	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.416+08
cc6f4176-b579-49c9-8624-2a8274ef0e71	20000000-0000-4000-8000-000000000005	2026-08-20	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.501+08
\.


--
-- Data for Name: event_registrations; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.event_registrations (registration_id, event_id, created_at, status, updated_at) FROM stdin;
50000000-0000-4000-8000-000000000008	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.172+08	SIGNED_UP	2026-07-24 22:45:17.301+08
50000000-0000-4000-8000-000000000009	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.175+08	SIGNED_UP	2026-07-24 22:45:17.303+08
50000000-0000-4000-8000-000000000010	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.176+08	SIGNED_UP	2026-07-24 22:45:17.305+08
50000000-0000-4000-8000-000000000011	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.178+08	SIGNED_UP	2026-07-24 22:45:17.307+08
50000000-0000-4000-8000-000000000012	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.18+08	SIGNED_UP	2026-07-24 22:45:17.308+08
50000000-0000-4000-8000-000000001001	20000000-0000-4000-8000-000000000002	2026-07-24 19:49:13.204+08	SIGNED_UP	2026-07-24 22:45:17.334+08
50000000-0000-4000-8000-000000001002	20000000-0000-4000-8000-000000000002	2026-07-24 19:49:13.207+08	SIGNED_UP	2026-07-24 22:45:17.337+08
50000000-0000-4000-8000-000000002003	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.236+08	SIGNED_UP	2026-07-24 22:45:17.371+08
50000000-0000-4000-8000-000000002004	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.238+08	SIGNED_UP	2026-07-24 22:45:17.373+08
50000000-0000-4000-8000-000000002005	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.24+08	SIGNED_UP	2026-07-24 22:45:17.375+08
50000000-0000-4000-8000-000000002006	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.241+08	SIGNED_UP	2026-07-24 22:45:17.377+08
50000000-0000-4000-8000-000000002007	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.243+08	SIGNED_UP	2026-07-24 22:45:17.379+08
50000000-0000-4000-8000-000000002008	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.245+08	CHECKED_IN	2026-07-24 22:45:17.382+08
50000000-0000-4000-8000-000000002009	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.246+08	CHECKED_IN	2026-07-24 22:45:17.384+08
50000000-0000-4000-8000-000000002010	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.248+08	CHECKED_IN	2026-07-24 22:45:17.386+08
50000000-0000-4000-8000-000000002011	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.251+08	CHECKED_IN	2026-07-24 22:45:17.388+08
50000000-0000-4000-8000-000000002012	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.252+08	CHECKED_IN	2026-07-24 22:45:17.39+08
50000000-0000-4000-8000-000000002013	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.254+08	COMPLETED	2026-07-24 22:45:17.391+08
50000000-0000-4000-8000-000000002014	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.256+08	COMPLETED	2026-07-24 22:45:17.394+08
50000000-0000-4000-8000-000000002015	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.258+08	COMPLETED	2026-07-24 22:45:17.395+08
50000000-0000-4000-8000-000000002016	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.26+08	COMPLETED	2026-07-24 22:45:17.397+08
50000000-0000-4000-8000-000000002017	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.262+08	COMPLETED	2026-07-24 22:45:17.399+08
50000000-0000-4000-8000-000000002018	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.264+08	COMPLETED	2026-07-24 22:45:17.402+08
50000000-0000-4000-8000-000000002019	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.266+08	COMPLETED	2026-07-24 22:45:17.404+08
50000000-0000-4000-8000-000000002020	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.268+08	COMPLETED	2026-07-24 22:45:17.406+08
50000000-0000-4000-8000-000000002021	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.27+08	COMPLETED	2026-07-24 22:45:17.408+08
50000000-0000-4000-8000-000000002022	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.271+08	CANCELLED	2026-07-24 22:45:17.41+08
50000000-0000-4000-8000-000000003001	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.293+08	COMPLETED	2026-07-24 22:45:17.435+08
50000000-0000-4000-8000-000000003002	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.295+08	COMPLETED	2026-07-24 22:45:17.438+08
50000000-0000-4000-8000-000000003003	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.297+08	COMPLETED	2026-07-24 22:45:17.44+08
50000000-0000-4000-8000-000000003004	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.299+08	COMPLETED	2026-07-24 22:45:17.442+08
50000000-0000-4000-8000-000000003005	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.3+08	COMPLETED	2026-07-24 22:45:17.444+08
50000000-0000-4000-8000-000000003006	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.302+08	COMPLETED	2026-07-24 22:45:17.446+08
50000000-0000-4000-8000-000000003007	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.304+08	COMPLETED	2026-07-24 22:45:17.448+08
50000000-0000-4000-8000-000000003008	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.306+08	COMPLETED	2026-07-24 22:45:17.45+08
50000000-0000-4000-8000-000000003009	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.308+08	COMPLETED	2026-07-24 22:45:17.452+08
50000000-0000-4000-8000-000000003010	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.309+08	COMPLETED	2026-07-24 22:45:17.454+08
50000000-0000-4000-8000-000000003011	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.311+08	COMPLETED	2026-07-24 22:45:17.456+08
50000000-0000-4000-8000-000000003012	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.313+08	COMPLETED	2026-07-24 22:45:17.458+08
50000000-0000-4000-8000-000000003013	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.315+08	COMPLETED	2026-07-24 22:45:17.46+08
50000000-0000-4000-8000-000000003014	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.317+08	COMPLETED	2026-07-24 22:45:17.462+08
50000000-0000-4000-8000-000000003015	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.319+08	COMPLETED	2026-07-24 22:45:17.464+08
50000000-0000-4000-8000-000000003016	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.321+08	COMPLETED	2026-07-24 22:45:17.466+08
50000000-0000-4000-8000-000000003017	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.323+08	COMPLETED	2026-07-24 22:45:17.468+08
50000000-0000-4000-8000-000000003018	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.325+08	COMPLETED	2026-07-24 22:45:17.47+08
50000000-0000-4000-8000-000000003019	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.327+08	COMPLETED	2026-07-24 22:45:17.472+08
50000000-0000-4000-8000-000000003020	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.329+08	COMPLETED	2026-07-24 22:45:17.474+08
50000000-0000-4000-8000-000000003021	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.331+08	COMPLETED	2026-07-24 22:45:17.477+08
50000000-0000-4000-8000-000000003022	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.333+08	COMPLETED	2026-07-24 22:45:17.479+08
50000000-0000-4000-8000-000000003023	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.335+08	COMPLETED	2026-07-24 22:45:17.481+08
50000000-0000-4000-8000-000000003024	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.337+08	COMPLETED	2026-07-24 22:45:17.483+08
50000000-0000-4000-8000-000000003025	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.338+08	COMPLETED	2026-07-24 22:45:17.485+08
50000000-0000-4000-8000-000000003026	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.34+08	COMPLETED	2026-07-24 22:45:17.487+08
50000000-0000-4000-8000-000000003027	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.342+08	COMPLETED	2026-07-24 22:45:17.489+08
50000000-0000-4000-8000-000000003028	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.344+08	COMPLETED	2026-07-24 22:45:17.491+08
50000000-0000-4000-8000-000000003029	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.345+08	COMPLETED	2026-07-24 22:45:17.493+08
50000000-0000-4000-8000-000000003030	20000000-0000-4000-8000-000000000004	2026-07-24 19:49:13.347+08	COMPLETED	2026-07-24 22:45:17.495+08
50000000-0000-4000-8000-000000004001	20000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.368+08	CANCELLED	2026-07-24 22:45:17.519+08
50000000-0000-4000-8000-000000004002	20000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.37+08	CANCELLED	2026-07-24 22:45:17.521+08
50000000-0000-4000-8000-000000004003	20000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.372+08	CANCELLED	2026-07-24 22:45:17.523+08
50000000-0000-4000-8000-000000004004	20000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.374+08	CANCELLED	2026-07-24 22:45:17.525+08
50000000-0000-4000-8000-000000004005	20000000-0000-4000-8000-000000000005	2026-07-24 19:49:13.376+08	CANCELLED	2026-07-24 22:45:17.526+08
50000000-0000-4000-8000-000000000001	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.158+08	SIGNED_UP	2026-07-24 22:45:17.287+08
50000000-0000-4000-8000-000000000002	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.16+08	SIGNED_UP	2026-07-24 22:45:17.29+08
50000000-0000-4000-8000-000000000003	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.162+08	SIGNED_UP	2026-07-24 22:45:17.291+08
50000000-0000-4000-8000-000000000004	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.164+08	SIGNED_UP	2026-07-24 22:45:17.293+08
50000000-0000-4000-8000-000000000005	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.166+08	SIGNED_UP	2026-07-24 22:45:17.295+08
50000000-0000-4000-8000-000000000006	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.168+08	SIGNED_UP	2026-07-24 22:45:17.297+08
50000000-0000-4000-8000-000000000007	20000000-0000-4000-8000-000000000001	2026-07-24 19:49:13.17+08	SIGNED_UP	2026-07-24 22:45:17.299+08
50000000-0000-4000-8000-000000001003	20000000-0000-4000-8000-000000000002	2026-07-24 19:49:13.209+08	SIGNED_UP	2026-07-24 22:45:17.339+08
50000000-0000-4000-8000-000000001004	20000000-0000-4000-8000-000000000002	2026-07-24 19:49:13.21+08	SIGNED_UP	2026-07-24 22:45:17.341+08
50000000-0000-4000-8000-000000002001	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.232+08	SIGNED_UP	2026-07-24 22:45:17.367+08
50000000-0000-4000-8000-000000002002	20000000-0000-4000-8000-000000000003	2026-07-24 19:49:13.234+08	SIGNED_UP	2026-07-24 22:45:17.369+08
\.


--
-- Data for Name: event_station_availabilities; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.event_station_availabilities (event_station_availability_id, event_station_id, event_day_id, is_available, starts_at, ends_at, capacity, created_at, updated_at) FROM stdin;
c825bf00-92a4-4b66-9888-3dd8f7f31ca3	37e67ea7-53ae-48cc-9d37-e3f6b20ff437	333a2f14-521e-444b-8b9e-10376f6e4ff9	t	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	3	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.269+08
5c89b060-b8cc-45f9-ad81-4fea234cb9b4	c32d8cf1-d767-4be4-a428-83df46bfc96f	333a2f14-521e-444b-8b9e-10376f6e4ff9	t	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	4	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.272+08
f4498d54-ecb5-40d0-95cb-2fba7ca8b92a	8858ebd1-0df7-4aa1-8576-4891c3f8b3b4	333a2f14-521e-444b-8b9e-10376f6e4ff9	t	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.276+08
539e223c-3605-47b2-8c58-f5841ac36f3c	bf181474-93ad-49a5-95bb-23eb1a1ba3a7	333a2f14-521e-444b-8b9e-10376f6e4ff9	t	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.279+08
bb139493-e51c-4d51-9d48-c81b9e1dd046	3c2b7d49-b4f8-4df5-8322-7aa7fa6d9176	740b8cd4-eb32-431c-969b-1b3697ec0a38	t	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	3	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.318+08
fc616e79-2567-4468-ab81-e63ad03009fd	46a827f0-1b08-4652-a837-a8b720c3beeb	740b8cd4-eb32-431c-969b-1b3697ec0a38	t	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	4	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.321+08
ea9a6128-6889-41ab-9abf-b5c381ba7329	a3264edc-33ea-41c8-be28-06caa90c3340	740b8cd4-eb32-431c-969b-1b3697ec0a38	t	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.325+08
c921213d-2613-408c-9945-395b5506d790	45cecede-dae7-4cbc-80ab-7ac0de40a5bd	740b8cd4-eb32-431c-969b-1b3697ec0a38	t	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.328+08
612f04d0-691e-4755-8c20-a07294e5e4c8	e458491f-97fc-4060-a4b0-a62e2c3c36f2	af859782-581f-4438-9e97-3f08a0bfa5fe	t	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	3	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.35+08
eb0b1101-9505-480b-98d1-adad08819b78	5194c6bc-546b-4dbd-9ded-6b2db5472c81	af859782-581f-4438-9e97-3f08a0bfa5fe	t	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	4	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.353+08
771c5d09-09f0-4f64-b63a-dc06a7c2be26	a8f63f87-f888-49c2-93fe-4dce150fd5b9	af859782-581f-4438-9e97-3f08a0bfa5fe	t	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.357+08
8564e01c-3fc6-4562-b3fc-ffb93265939e	d4d010fc-89d6-4ed5-948e-6ae27a314b8e	af859782-581f-4438-9e97-3f08a0bfa5fe	t	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.36+08
ee20d508-eb3d-4640-8e45-b7961b03a35c	cd31b594-8183-4785-9d36-96d524956438	c8525713-faf4-4048-827f-b587bddfb719	t	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	3	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.42+08
45b2a5c8-82ef-42ca-ae6e-820104af9b97	d49b0c59-f179-4987-9a3b-f94feb027e8b	c8525713-faf4-4048-827f-b587bddfb719	t	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	4	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.423+08
a0b0f3ff-a513-4428-b067-d78c925aa3a3	211be5c5-09e5-4adf-ae0a-af3bbcea0d27	c8525713-faf4-4048-827f-b587bddfb719	t	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.427+08
d8c8f7eb-55e5-43f8-bc8e-39edba792c45	37c211aa-3666-440f-b8af-18fcb37827e9	c8525713-faf4-4048-827f-b587bddfb719	t	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.429+08
b0c3bbaa-7de7-44fe-89a5-26476a4744a1	090ac07c-d474-4720-b38b-c27f3375b75d	cc6f4176-b579-49c9-8624-2a8274ef0e71	t	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	3	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.504+08
c9223d82-fac8-43d6-a85b-af72a72296d6	3305aec4-8771-4304-870a-b37e47528134	cc6f4176-b579-49c9-8624-2a8274ef0e71	t	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	4	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.507+08
ec788f20-a85e-4ee7-9e7b-d13fa1a17eaf	180cdde4-6871-4baf-a927-aea0f97e8315	cc6f4176-b579-49c9-8624-2a8274ef0e71	t	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.511+08
ed840b17-95dc-4d9e-ae78-1a2ff4cb96cf	4940f17d-35e5-44c5-886a-bc7767518764	cc6f4176-b579-49c9-8624-2a8274ef0e71	t	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	2	2026-07-24 22:45:15.03+08	2026-07-24 22:45:17.514+08
\.


--
-- Data for Name: event_stations; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.event_stations (event_station_id, event_id, station_template_id, template_version, name, description, station_order, capacity, is_available, created_at, updated_at) FROM stdin;
37e67ea7-53ae-48cc-9d37-e3f6b20ff437	20000000-0000-4000-8000-000000000001	60000000-0000-4000-8000-000000000001	1	Registration	Confirm the participant record, consent, and QR pass.	1	3	t	2026-07-24 19:49:13.138+08	2026-07-24 19:49:13.138+08
c32d8cf1-d767-4be4-a428-83df46bfc96f	20000000-0000-4000-8000-000000000001	60000000-0000-4000-8000-000000000002	1	Visual acuity	Capture controlled distance and near-vision measurements.	2	4	t	2026-07-24 19:49:13.142+08	2026-07-24 19:49:13.142+08
8858ebd1-0df7-4aa1-8576-4891c3f8b3b4	20000000-0000-4000-8000-000000000001	60000000-0000-4000-8000-000000000003	1	Eye health	Record eye-health observations and screening flags.	3	2	t	2026-07-24 19:49:13.144+08	2026-07-24 19:49:13.144+08
bf181474-93ad-49a5-95bb-23eb1a1ba3a7	20000000-0000-4000-8000-000000000001	60000000-0000-4000-8000-000000000004	1	Clinical review	Review screening outcomes and decide the safe next step.	4	2	t	2026-07-24 19:49:13.147+08	2026-07-24 19:49:13.147+08
3c2b7d49-b4f8-4df5-8322-7aa7fa6d9176	20000000-0000-4000-8000-000000000002	60000000-0000-4000-8000-000000000001	1	Registration	Confirm the participant record, consent, and QR pass.	1	3	t	2026-07-24 19:49:13.186+08	2026-07-24 19:49:13.186+08
46a827f0-1b08-4652-a837-a8b720c3beeb	20000000-0000-4000-8000-000000000002	60000000-0000-4000-8000-000000000002	1	Visual acuity	Capture controlled distance and near-vision measurements.	2	4	t	2026-07-24 19:49:13.19+08	2026-07-24 19:49:13.19+08
a3264edc-33ea-41c8-be28-06caa90c3340	20000000-0000-4000-8000-000000000002	60000000-0000-4000-8000-000000000003	1	Eye health	Record eye-health observations and screening flags.	3	2	t	2026-07-24 19:49:13.192+08	2026-07-24 19:49:13.192+08
45cecede-dae7-4cbc-80ab-7ac0de40a5bd	20000000-0000-4000-8000-000000000002	60000000-0000-4000-8000-000000000004	1	Clinical review	Review screening outcomes and decide the safe next step.	4	2	t	2026-07-24 19:49:13.195+08	2026-07-24 19:49:13.195+08
e458491f-97fc-4060-a4b0-a62e2c3c36f2	20000000-0000-4000-8000-000000000003	60000000-0000-4000-8000-000000000001	1	Registration	Confirm the participant record, consent, and QR pass.	1	3	t	2026-07-24 19:49:13.215+08	2026-07-24 19:49:13.215+08
5194c6bc-546b-4dbd-9ded-6b2db5472c81	20000000-0000-4000-8000-000000000003	60000000-0000-4000-8000-000000000002	1	Visual acuity	Capture controlled distance and near-vision measurements.	2	4	t	2026-07-24 19:49:13.218+08	2026-07-24 19:49:13.218+08
a8f63f87-f888-49c2-93fe-4dce150fd5b9	20000000-0000-4000-8000-000000000003	60000000-0000-4000-8000-000000000003	1	Eye health	Record eye-health observations and screening flags.	3	2	t	2026-07-24 19:49:13.22+08	2026-07-24 19:49:13.22+08
d4d010fc-89d6-4ed5-948e-6ae27a314b8e	20000000-0000-4000-8000-000000000003	60000000-0000-4000-8000-000000000004	1	Clinical review	Review screening outcomes and decide the safe next step.	4	2	t	2026-07-24 19:49:13.223+08	2026-07-24 19:49:13.223+08
cd31b594-8183-4785-9d36-96d524956438	20000000-0000-4000-8000-000000000004	60000000-0000-4000-8000-000000000001	1	Registration	Confirm the participant record, consent, and QR pass.	1	3	t	2026-07-24 19:49:13.277+08	2026-07-24 19:49:13.277+08
d49b0c59-f179-4987-9a3b-f94feb027e8b	20000000-0000-4000-8000-000000000004	60000000-0000-4000-8000-000000000002	1	Visual acuity	Capture controlled distance and near-vision measurements.	2	4	t	2026-07-24 19:49:13.279+08	2026-07-24 19:49:13.279+08
211be5c5-09e5-4adf-ae0a-af3bbcea0d27	20000000-0000-4000-8000-000000000004	60000000-0000-4000-8000-000000000003	1	Eye health	Record eye-health observations and screening flags.	3	2	t	2026-07-24 19:49:13.281+08	2026-07-24 19:49:13.281+08
37c211aa-3666-440f-b8af-18fcb37827e9	20000000-0000-4000-8000-000000000004	60000000-0000-4000-8000-000000000004	1	Clinical review	Review screening outcomes and decide the safe next step.	4	2	t	2026-07-24 19:49:13.284+08	2026-07-24 19:49:13.284+08
090ac07c-d474-4720-b38b-c27f3375b75d	20000000-0000-4000-8000-000000000005	60000000-0000-4000-8000-000000000001	1	Registration	Confirm the participant record, consent, and QR pass.	1	3	t	2026-07-24 19:49:13.353+08	2026-07-24 19:49:13.353+08
3305aec4-8771-4304-870a-b37e47528134	20000000-0000-4000-8000-000000000005	60000000-0000-4000-8000-000000000002	1	Visual acuity	Capture controlled distance and near-vision measurements.	2	4	t	2026-07-24 19:49:13.355+08	2026-07-24 19:49:13.355+08
180cdde4-6871-4baf-a927-aea0f97e8315	20000000-0000-4000-8000-000000000005	60000000-0000-4000-8000-000000000003	1	Eye health	Record eye-health observations and screening flags.	3	2	t	2026-07-24 19:49:13.358+08	2026-07-24 19:49:13.358+08
4940f17d-35e5-44c5-886a-bc7767518764	20000000-0000-4000-8000-000000000005	60000000-0000-4000-8000-000000000004	1	Clinical review	Review screening outcomes and decide the safe next step.	4	2	t	2026-07-24 19:49:13.361+08	2026-07-24 19:49:13.361+08
\.


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.events (event_id, name, description, venue, starts_at, ends_at, capacity, status, created_by_user_id, cancelled_by_user_id, cancelled_at, cancellation_reason, created_at, updated_at, timezone, version, banner_key, artwork_data_url, address, postal_code, latitude, longitude, location_provider, location_reference, expected_attendance, create_idempotency_key, create_payload_hash) FROM stdin;
20000000-0000-4000-8000-000000000001	Northside Community Screening	Seeded demonstration event for the issue #7 lifecycle flow.	Northside Community Hall	2026-08-12 08:00:00+08	2026-08-12 16:00:00+08	180	PUBLISHED	10000000-0000-4000-8000-000000000002	\N	\N	\N	2026-07-24 19:49:13.133+08	2026-07-24 22:45:17.247+08	Asia/Singapore	1	COMMUNITY_SCREENING	\N	\N	\N	\N	\N	MANUAL	\N	1800	\N	\N
20000000-0000-4000-8000-000000000002	Riverside Vision Day	Seeded demonstration event for the issue #7 lifecycle flow.	Riverside Civic Centre	2026-09-05 09:00:00+08	2026-09-05 15:00:00+08	120	DRAFT	10000000-0000-4000-8000-000000000002	\N	\N	\N	2026-07-24 19:49:13.182+08	2026-07-24 22:45:17.311+08	Asia/Singapore	1	COMMUNITY_SCREENING	\N	\N	\N	\N	\N	MANUAL	\N	1200	\N	\N
20000000-0000-4000-8000-000000000003	Central Library Screening	Seeded demonstration event for the issue #7 lifecycle flow.	Central Library Atrium	2026-07-22 09:00:00+08	2026-07-22 17:00:00+08	200	IN_PROGRESS	10000000-0000-4000-8000-000000000002	\N	\N	\N	2026-07-24 19:49:13.212+08	2026-07-24 22:45:17.343+08	Asia/Singapore	1	COMMUNITY_SCREENING	\N	\N	\N	\N	\N	MANUAL	\N	2000	\N	\N
20000000-0000-4000-8000-000000000004	West End Community Check	Seeded demonstration event for the issue #7 lifecycle flow.	West End Activity Centre	2026-06-18 08:00:00+08	2026-06-18 15:00:00+08	150	COMPLETED	10000000-0000-4000-8000-000000000002	\N	\N	\N	2026-07-24 19:49:13.273+08	2026-07-24 22:45:17.412+08	Asia/Singapore	1	COMMUNITY_SCREENING	\N	\N	\N	\N	\N	MANUAL	\N	1500	\N	\N
20000000-0000-4000-8000-000000000005	Harbour Family Screening	Seeded demonstration event for the issue #7 lifecycle flow.	Harbour Community Room	2026-08-20 08:00:00+08	2026-08-20 14:00:00+08	100	CANCELLED	10000000-0000-4000-8000-000000000002	10000000-0000-4000-8000-000000000001	2026-07-20 12:00:00+08	Venue became unavailable and requires rescheduling.	2026-07-24 19:49:13.349+08	2026-07-24 22:45:17.497+08	Asia/Singapore	1	COMMUNITY_SCREENING	\N	\N	\N	\N	\N	MANUAL	\N	1000	\N	\N
\.


--
-- Data for Name: notification_deliveries; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.notification_deliveries (notification_delivery_id, referral_id, document_id, channel, recipient_address_encrypted, template_key, provider_message_id, status, attempt_count, last_attempt_at, delivered_at, failure_code, failure_message, idempotency_key, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: participant_event_registrations; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.participant_event_registrations (registration_id, participant_id, event_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: participants; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.participants (participant_id, first_name, last_name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: qr_code_passes; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.qr_code_passes (qr_id, registration_id, token, issued_at, expires_at, is_active, revoked_at, revoked_by_user_id, revoked_reason) FROM stdin;
\.


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.referrals (referral_id, review_id, registration_id, created_by_user_id, destination_name, destination_email, reason, instructions, urgency, status, referred_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: refresh_sessions; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.refresh_sessions (refresh_session_id, user_id, family_id, token_hash, expires_at, last_used_at, rotated_at, revoked_at, reuse_detected_at, replaced_by_session_id, user_agent_hash, network_hint, created_at) FROM stdin;
5881b365-0f49-48fd-8adb-273b0f9ae544	10000000-0000-4000-8000-000000000002	f683e10d-924e-4e83-8ec9-16bb542c781e	e6f66a0d0cc53ee1bc18083895b805f35653e46f0ecb174b6b48a3f9a3acba25	2026-07-31 19:50:33.067+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-24 19:50:33.068+08
3f213024-8d7c-42c0-bb82-0135b0b008c1	10000000-0000-4000-8000-000000000002	a17301f2-9702-4789-b373-3ccaf5848451	6abd8b70c16a2296d45877e375db1fc2e2f543937b31f483761497a8aac48362	2026-07-31 20:02:51.032+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	1489272f523f94114bdec2d82b1ce73f	2026-07-24 20:02:51.033+08
eeec5c62-dc5b-41d7-adab-20c363560aa7	10000000-0000-4000-8000-000000000002	d8bd41bd-a27a-4cc1-b75d-de68beb44768	0292853f3312cd8272116166d13cac67fcfc605dc6da2399bdf7207be191bffa	2026-07-31 20:06:53.002+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	1489272f523f94114bdec2d82b1ce73f	2026-07-24 20:06:53.003+08
d4ba5cdf-28c8-45ab-8d5f-9b87916623a5	10000000-0000-4000-8000-000000000002	897e65b8-b754-4059-b0af-f7dd780d8dbd	86165e5d27cadbf17e07f5658c9485259d2e84131c8132a9127d5d3ffffa6c31	2026-07-31 20:10:38.236+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-24 20:10:38.236+08
d8b8ba11-4d58-44c6-896e-1907f2f9a3ae	10000000-0000-4000-8000-000000000002	34a29dff-8f64-4d15-854b-d72065370614	72fbbff035a389f9cc9b36e81bbd7e0299a67532cb03850f08f444704b6872e5	2026-07-31 20:44:45.659+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-24 20:44:45.66+08
46a0d686-43cf-456c-9ab6-e687929732f0	10000000-0000-4000-8000-000000000002	34a29dff-8f64-4d15-854b-d72065370614	d4d9d9c506f62063f941c9d0f26db6a8159d6f4c509fcbe35b0c3d188c623ac8	2026-07-31 20:28:10.941+08	2026-07-24 20:44:45.661+08	2026-07-24 20:44:45.661+08	\N	\N	d8b8ba11-4d58-44c6-896e-1907f2f9a3ae	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-24 20:28:10.942+08
7485e1b1-f4db-45e7-ac16-b873babbee24	10000000-0000-4000-8000-000000000002	9282fe2f-e2b3-4d08-be99-2c0aafecc9b3	5642e73652d8cde5bb5d15eab65da3feeb47a0903413a3fed2c420bdb1c1c397	2026-07-31 22:42:20.294+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-24 22:42:20.295+08
13af1d55-7251-48be-8d58-501a1d445c35	10000000-0000-4000-8000-000000000002	cf0462ca-3b53-4d05-93ee-b00979cf7748	8e1fd11942f4abfaa8198e48dce657e9a64fc3b2aad8ee89ea2e78304bdb7559	2026-07-31 22:45:38.074+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-24 22:45:38.075+08
9011db73-1015-475b-b3e5-c30457aa04a4	10000000-0000-4000-8000-000000000001	a9a183b4-55e1-4dc2-9647-f86e2b962927	f48df640a660257939a717eb126f0e43f047a25de38f138c53f1761caf1bcde9	2026-08-02 10:07:44.64+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:07:44.641+08
d838215c-a6a8-46e1-abb4-107db6daf8b0	10000000-0000-4000-8000-000000000001	c122bd78-da7b-4c0e-9915-8019bc408748	9ac977b1b403e927bfd79c2a9788c29556162f1ff3ca2fee32b17df61575246f	2026-08-02 10:18:32.905+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:18:32.906+08
c515cd87-46bc-491d-9886-60f36cc02ffa	10000000-0000-4000-8000-000000000001	a17369cb-5b61-4056-99c1-9d324733d3e6	29013ec34a3748f0145f75efe4d820e53f019b9e07732fe8258093cbf5f60754	2026-08-02 10:24:56.311+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:24:56.311+08
42b00f51-e0c4-461a-8d32-0067f3de5d45	10000000-0000-4000-8000-000000000001	74467226-457b-4f4d-85bf-dc8e28e967fb	1801e924f12ee1fcf4eebad71405d1626c007ca04ee0ce5faf7fad2f1fb21379	2026-08-02 10:39:04.306+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:39:04.307+08
f6c808de-e100-4036-ac09-b5b5f3a0a221	10000000-0000-4000-8000-000000000001	dfa4ab40-fd71-446c-9232-c3e2c939821f	ac978fa7b55d789479a404b4fe406450123975e6799844251e3761759de47998	2026-08-02 10:52:41.925+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:52:41.925+08
2ef8d3ee-db34-45f1-86eb-e1f9c39be31e	10000000-0000-4000-8000-000000000001	c4645db4-58b1-4aee-83ae-8cdd1daed7c9	8d608cfc7c053d31043a69467556d6e1946dc2090f25289d09eeef8bc22dc7dc	2026-08-02 10:57:32.182+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 10:57:32.183+08
f3a6f6be-e6e8-40db-a355-65f835814110	10000000-0000-4000-8000-000000000002	c6ff06ac-3000-4b49-b8d7-68544628375f	6020b9be69b590c72b0484f246c2774f7645d34605f216de53727b448745f2b4	2026-08-02 12:39:08.826+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 12:39:08.827+08
8f14f932-76b3-4df0-a6b7-df01c6c5f599	10000000-0000-4000-8000-000000000002	a1072188-ccf6-4aaa-a7af-b20d8368f1bd	f6b9be4dc1572aedaa1d274d4ca318a89163a4b9549df4977c48d4e18e6b8a27	2026-08-02 12:47:36.222+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 12:47:36.223+08
d381d074-270b-40a1-b1e6-7f7f7cc6e75e	10000000-0000-4000-8000-000000000002	399ee6f3-c167-4c17-9804-d45a73dca8d0	c718b8c398bd27d48ae731c08f22d373fa35aeb7b9f2c0dd6a19833cb21e36ba	2026-08-02 12:47:50.179+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 12:47:50.18+08
60b3c4c1-0105-47ec-92c7-4f456afcf57c	10000000-0000-4000-8000-000000000001	a1993ce9-2417-4542-84f2-e61b090ad552	7eda449cbaaa5212d729f4d57fd0998a3a20635c71022cc68c99620c53014967	2026-08-02 12:48:10.922+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 12:48:10.923+08
200ec7a4-a010-4abd-bbfa-1eb35c9c1979	10000000-0000-4000-8000-000000000002	de7170f4-bb75-4cc0-b05a-46a579b99ef5	452d565b92447f76e972b83307a439fd3f0b906d1facd75fe52bf8fb6e4912c7	2026-08-02 12:48:11.246+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 12:48:11.247+08
ec2e5059-c00d-4a9a-9a38-711ed52b2659	10000000-0000-4000-8000-000000000003	c6ae50e4-9f33-4809-baa7-6358ef86d89a	1cf8a7da32e498e9feb9f36445f1fb3e5f23f48a1fcde0d9bc2bcfc4f2ecbb60	2026-08-02 12:48:11.523+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 12:48:11.523+08
4a615a6f-3de3-443d-ad45-fa2133847ace	10000000-0000-4000-8000-000000000001	d2dbc7ed-3317-4f42-b4c9-4d3aab85df74	788360202a171d38c2aaf20cc57dd19ec6da79199f7b188b704060a8391760b6	2026-08-02 13:11:35.297+08	\N	\N	\N	\N	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	dc020b839f720dbf457d6e9d26d810be	2026-07-26 13:11:35.298+08
ca278014-e3bb-4486-abee-a27dcc9b80f1	10000000-0000-4000-8000-000000000002	5ae9f2eb-78fe-488e-8a65-3864644263dc	8f721aad3867f0496c97b5bc31882ea6f838d249b2eb9e672fdd0ab7da1c55d7	2026-08-02 14:41:37.303+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	1489272f523f94114bdec2d82b1ce73f	2026-07-26 14:41:37.304+08
c2b045ef-deb3-4f4d-a77a-ad5595a18ee3	10000000-0000-4000-8000-000000000002	170e53fb-e393-4edf-a19d-ced6d591941c	f535d27572082fb7cd5dcb62be6f322e5be367ade16d673989d43298a654f255	2026-08-02 14:42:59.712+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 14:42:59.713+08
7a3ee4f5-bbd3-4bd6-80cb-d46e7aaaa26b	10000000-0000-4000-8000-000000000002	95258b44-c74c-4f15-b42c-1ba5a4503686	40c8ddb497d5b724f0f1084faad1157578325c292cf19c014907526c1f71527f	2026-08-02 14:43:12.272+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 14:43:12.273+08
b6584386-d31d-42e3-9d3e-bf11a2d5a3a8	10000000-0000-4000-8000-000000000002	d94d6397-7575-4ae9-b102-387a8fbeebbb	e7ccef61f489378f463c5f5aa5500c2ca7fea6f31b8edf4c7c0fc845bbc8e788	2026-08-02 14:43:34.454+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 14:43:34.454+08
72e44db1-e1ba-4113-b2c4-eefb78acc28d	10000000-0000-4000-8000-000000000002	5ccf7c82-27e2-4900-ab39-014e5c9ecf18	d0bf9f86822bb69f84056360011f87b2cc0d7230f91b94754b107a2f8d974792	2026-08-02 14:45:37.981+08	\N	\N	\N	\N	\N	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 14:45:37.982+08
5c53fd76-bd98-4595-b9fd-3fe6ae236758	10000000-0000-4000-8000-000000000002	5ccf7c82-27e2-4900-ab39-014e5c9ecf18	84795b5a958f47c3e5ba07f6b4f9b7f350ad963db84efe4ce9f644c75f9a5375	2026-08-02 14:45:37.947+08	2026-07-26 14:45:37.982+08	2026-07-26 14:45:37.982+08	\N	\N	72e44db1-e1ba-4113-b2c4-eefb78acc28d	87da89131acc05cb861c80340d3d7610f6b74ee9991b0ccc2c3e88e06949c659	12ca17b49af2289436f303e0166030a2	2026-07-26 14:45:37.948+08
1b052b1c-883d-41b8-97fe-c1f194c6b50b	10000000-0000-4000-8000-000000000001	6ab6c0bb-a2da-4221-bfba-eec0f60e06e0	5675ab5fd3a42172ca492afa0e8b1dea06d0f533c8c3210d48626ea6fcc597c5	2026-08-02 15:14:09.635+08	\N	\N	2026-07-26 15:14:09.645+08	2026-07-26 15:14:09.645+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 15:14:09.636+08
5f65ed14-9881-49cd-b67c-aca0228749fe	10000000-0000-4000-8000-000000000001	6ab6c0bb-a2da-4221-bfba-eec0f60e06e0	b030dc4fe9dac8f9e75b9ec8612e502f11d827d55bd9805aaf9c89fa14586e77	2026-08-02 14:50:45.914+08	2026-07-26 15:14:09.637+08	2026-07-26 15:14:09.637+08	2026-07-26 15:14:09.645+08	2026-07-26 15:14:09.645+08	1b052b1c-883d-41b8-97fe-c1f194c6b50b	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 14:50:45.914+08
b2a00036-46bf-4220-a236-1342a5cc4d5e	10000000-0000-4000-8000-000000000001	67c8d580-9eb0-49da-a4d3-64ea8ee9019c	9bea70dd80f9ecec47e1813544a543b2dee08b0a2746795d84f25f8cda79c770	2026-08-02 15:18:31.457+08	2026-07-26 15:27:25.325+08	2026-07-26 15:27:25.325+08	2026-07-26 15:27:25.331+08	2026-07-26 15:27:25.331+08	01b9e13c-5c3a-495e-8d7a-d16b6c38d639	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 15:18:31.457+08
01b9e13c-5c3a-495e-8d7a-d16b6c38d639	10000000-0000-4000-8000-000000000001	67c8d580-9eb0-49da-a4d3-64ea8ee9019c	479f79fa17c6648c4c4bc3e1ff071fa499afb73b9622901b835c97425914ed26	2026-08-02 15:27:25.323+08	\N	\N	2026-07-26 15:27:25.331+08	2026-07-26 15:27:25.331+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 15:27:25.324+08
89117ec6-e508-4900-afa1-8190b98a268a	10000000-0000-4000-8000-000000000001	9bae5bd0-30ee-4a5e-9407-2f9e9ff22bac	2e0d2887455de269f7170d59fe04c9e853b98836dddb82f68a12790264f30b51	2026-08-02 15:27:31.633+08	2026-07-26 15:39:35.202+08	2026-07-26 15:39:35.202+08	2026-07-26 15:39:53.254+08	2026-07-26 15:39:53.254+08	bdc9f280-8399-492b-8745-ea8dc082c69a	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 15:27:31.634+08
bdc9f280-8399-492b-8745-ea8dc082c69a	10000000-0000-4000-8000-000000000001	9bae5bd0-30ee-4a5e-9407-2f9e9ff22bac	41476e88c8b42bb1d22a9103631cfd41a35a833d7e795f54a3faadce52c62496	2026-08-02 15:39:35.2+08	\N	\N	2026-07-26 15:39:53.254+08	2026-07-26 15:39:53.254+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-26 15:39:35.201+08
c9402c97-43ca-4d82-addd-df7cd4750da8	10000000-0000-4000-8000-000000000001	a963744e-54a4-4565-87e7-60f43d014277	12e654dccd5600c0fb163b466bd1a4b3f6f4de0f8a76dd7fec4e39fcc6136f7a	2026-08-03 10:27:04.327+08	2026-07-27 10:29:29.881+08	2026-07-27 10:29:29.881+08	2026-07-27 10:29:29.891+08	2026-07-27 10:29:29.891+08	38c3eebb-d14a-4838-96f4-6f72775c9da9	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 10:27:04.328+08
38c3eebb-d14a-4838-96f4-6f72775c9da9	10000000-0000-4000-8000-000000000001	a963744e-54a4-4565-87e7-60f43d014277	20505689f41a930f7e3c5c054bc8a1d2a241b44913c5ea2dc746f4c9a947b5fb	2026-08-03 10:29:29.88+08	\N	\N	2026-07-27 10:29:29.891+08	2026-07-27 10:29:29.891+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 10:29:29.881+08
796ddb18-7a4d-446e-aa3c-63bf154f0539	10000000-0000-4000-8000-000000000001	fc36637b-9e57-4745-87ef-7847d57cae97	5ba1cdbb73684665300b650e50502a03d38a424596871d157cb237e5ed30a6a8	2026-08-03 10:29:42.712+08	2026-07-27 11:06:07.073+08	2026-07-27 11:06:07.073+08	2026-07-27 11:06:07.084+08	2026-07-27 11:06:07.084+08	36afc42d-c287-4c22-8a5c-8b3dc91eb6b9	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 10:29:42.713+08
36afc42d-c287-4c22-8a5c-8b3dc91eb6b9	10000000-0000-4000-8000-000000000001	fc36637b-9e57-4745-87ef-7847d57cae97	36780bc1d0ec4a58ad5fb908193b1856cf76912be8b5bf4a9112a1654059465d	2026-08-03 11:06:07.072+08	\N	\N	2026-07-27 11:06:07.084+08	2026-07-27 11:06:07.084+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 11:06:07.072+08
74d2fea4-90d0-4206-80b5-7a424ecff9c4	10000000-0000-4000-8000-000000000001	19c5b98a-b3ee-43d3-8fb7-348dc7415f85	a01315adb49a950a243a633ed6ed8d550f6f38b8ff1067a76ba300b78332b42f	2026-08-03 11:19:25.09+08	2026-07-27 12:30:12.99+08	2026-07-27 12:30:12.99+08	2026-07-27 12:30:12.997+08	2026-07-27 12:30:12.997+08	10eda515-1763-4f05-be44-d1fa39807f0a	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 11:19:25.091+08
10eda515-1763-4f05-be44-d1fa39807f0a	10000000-0000-4000-8000-000000000001	19c5b98a-b3ee-43d3-8fb7-348dc7415f85	3373c90d0a70fb8ec1a6ea4cebb218e192e25e9f3dff5e5b6243411a0d0c796a	2026-08-03 12:30:12.988+08	\N	\N	2026-07-27 12:30:12.997+08	2026-07-27 12:30:12.997+08	\N	dc0402b6bd1e97f986b003f0830c79d8eaba098b7e60f0baa12d03cc50798593	12ca17b49af2289436f303e0166030a2	2026-07-27 12:30:12.989+08
\.


--
-- Data for Name: reviews; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.reviews (review_id, registration_id, reviewed_by_user_id, outcome, urgency, clinical_summary, recommendations, reviewed_at, version, supersedes_review_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: shifts; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.shifts (shift_id, event_id, name, starts_at, ends_at, required_staff, status, created_at, updated_at) FROM stdin;
4fe9de23-e158-4c42-a6b4-1afb7ce47ab2	20000000-0000-4000-8000-000000000001	Morning operations	2026-08-12 08:00:00+08	2026-08-12 12:00:00+08	8	PLANNED	2026-07-24 19:49:13.133+08	2026-07-24 19:49:13.133+08
72e29e0b-4f9e-48ad-a1be-4798cac1cf23	20000000-0000-4000-8000-000000000002	Morning operations	2026-09-05 09:00:00+08	2026-09-05 13:00:00+08	8	PLANNED	2026-07-24 19:49:13.182+08	2026-07-24 19:49:13.182+08
a1c4e5ef-14a2-408a-bbc6-55628c88a119	20000000-0000-4000-8000-000000000003	Morning operations	2026-07-22 09:00:00+08	2026-07-22 13:00:00+08	8	ACTIVE	2026-07-24 19:49:13.212+08	2026-07-24 19:49:13.212+08
f76a13ad-ad11-400d-b711-d96a3443cdc8	20000000-0000-4000-8000-000000000004	Morning operations	2026-06-18 08:00:00+08	2026-06-18 12:00:00+08	8	COMPLETED	2026-07-24 19:49:13.273+08	2026-07-24 19:49:13.273+08
a5778d14-12d3-4791-a2d4-98fb29f7186d	20000000-0000-4000-8000-000000000005	Morning operations	2026-08-20 08:00:00+08	2026-08-20 12:00:00+08	8	CANCELLED	2026-07-24 19:49:13.349+08	2026-07-24 19:49:13.349+08
\.


--
-- Data for Name: staff_assignments; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.staff_assignments (staff_assignment_id, shift_id, user_id, event_station_id, assignment_role, status, assigned_by_user_id, notes, created_at, updated_at) FROM stdin;
18db198f-61a1-4ca1-9074-415c96610781	4fe9de23-e158-4c42-a6b4-1afb7ce47ab2	10000000-0000-4000-8000-000000000003	c32d8cf1-d767-4be4-a428-83df46bfc96f	SCREENER	ASSIGNED	10000000-0000-4000-8000-000000000002	\N	2026-07-24 19:49:13.152+08	2026-07-24 22:45:17.283+08
4dd1350e-91bd-411c-9fc6-5faabcf2f6d9	72e29e0b-4f9e-48ad-a1be-4798cac1cf23	10000000-0000-4000-8000-000000000003	46a827f0-1b08-4652-a837-a8b720c3beeb	SCREENER	ASSIGNED	10000000-0000-4000-8000-000000000002	\N	2026-07-24 19:49:13.199+08	2026-07-24 22:45:17.332+08
6dc727eb-b405-4d13-90e5-ac38c6121f75	a1c4e5ef-14a2-408a-bbc6-55628c88a119	10000000-0000-4000-8000-000000000003	5194c6bc-546b-4dbd-9ded-6b2db5472c81	SCREENER	CONFIRMED	10000000-0000-4000-8000-000000000002	\N	2026-07-24 19:49:13.226+08	2026-07-24 22:45:17.364+08
48e74519-5511-4d26-a330-c82778902981	f76a13ad-ad11-400d-b711-d96a3443cdc8	10000000-0000-4000-8000-000000000003	d49b0c59-f179-4987-9a3b-f94feb027e8b	SCREENER	COMPLETED	10000000-0000-4000-8000-000000000002	\N	2026-07-24 19:49:13.288+08	2026-07-24 22:45:17.433+08
94dea021-554a-47af-9fa8-f49b10974a50	a5778d14-12d3-4791-a2d4-98fb29f7186d	10000000-0000-4000-8000-000000000003	3305aec4-8771-4304-870a-b37e47528134	SCREENER	CANCELLED	10000000-0000-4000-8000-000000000002	\N	2026-07-24 19:49:13.364+08	2026-07-24 22:45:17.517+08
\.


--
-- Data for Name: station_templates; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.station_templates (station_template_id, template_key, version, name, description, default_capacity, active, created_at, updated_at) FROM stdin;
60000000-0000-4000-8000-000000000001	REGISTRATION	1	Registration	Confirm the participant record, consent, and QR pass.	3	t	2026-07-24 19:49:13.123+08	2026-07-24 22:45:17.237+08
60000000-0000-4000-8000-000000000002	VISUAL_ACUITY	1	Visual acuity	Capture controlled distance and near-vision measurements.	4	t	2026-07-24 19:49:13.126+08	2026-07-24 22:45:17.239+08
60000000-0000-4000-8000-000000000003	EYE_HEALTH	1	Eye health	Record eye-health observations and screening flags.	2	t	2026-07-24 19:49:13.128+08	2026-07-24 22:45:17.242+08
60000000-0000-4000-8000-000000000004	CLINICAL_REVIEW	1	Clinical review	Review screening outcomes and decide the safe next step.	2	t	2026-07-24 19:49:13.131+08	2026-07-24 22:45:17.244+08
\.


--
-- Data for Name: sync_actions; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.sync_actions (sync_action_id, device_id, actor_user_id, registration_id, entity_type, entity_id, operation, base_version, payload, status, attempt_count, error_code, error_details, received_at, processed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: vsms_app
--

COPY public.users (user_id, email, password_hash, system_role, status, failed_login_attempts, locked_until, last_login_at, created_at, updated_at, username) FROM stdin;
10000000-0000-4000-8000-000000000003	staff@vsms.local	$2b$12$fp.kpDdKW285oLl4ivnSLuq1xP/3Cr/3JD.O6esE9Z0vUHkFFNTWW	STAFF	ACTIVE	0	\N	2026-07-26 12:48:11.521+08	2026-07-24 19:49:13.12+08	2026-07-26 12:48:11.522+08	jordan.lee
10000000-0000-4000-8000-000000000002	manager@vsms.local	$2b$12$fp.kpDdKW285oLl4ivnSLuq1xP/3Cr/3JD.O6esE9Z0vUHkFFNTWW	EVENT_MANAGER	ACTIVE	0	\N	2026-07-26 14:45:37.945+08	2026-07-24 19:49:13.118+08	2026-07-26 14:45:37.946+08	maya.patel
10000000-0000-4000-8000-000000000001	admin@vsms.local	$2b$12$fp.kpDdKW285oLl4ivnSLuq1xP/3Cr/3JD.O6esE9Z0vUHkFFNTWW	ADMIN	ACTIVE	0	\N	2026-07-27 11:19:25.084+08	2026-07-24 19:49:13.113+08	2026-07-27 11:19:25.085+08	avery.chen
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: document_artifacts document_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.document_artifacts
    ADD CONSTRAINT document_artifacts_pkey PRIMARY KEY (document_id);


--
-- Name: event_audit_logs event_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_audit_logs
    ADD CONSTRAINT event_audit_logs_pkey PRIMARY KEY (event_audit_log_id);


--
-- Name: event_days event_days_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_days
    ADD CONSTRAINT event_days_pkey PRIMARY KEY (event_day_id);


--
-- Name: event_registrations event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (registration_id);


--
-- Name: event_station_availabilities event_station_availabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_station_availabilities
    ADD CONSTRAINT event_station_availabilities_pkey PRIMARY KEY (event_station_availability_id);


--
-- Name: event_stations event_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_stations
    ADD CONSTRAINT event_stations_pkey PRIMARY KEY (event_station_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (event_id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (notification_delivery_id);


--
-- Name: participant_event_registrations participant_event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.participant_event_registrations
    ADD CONSTRAINT participant_event_registrations_pkey PRIMARY KEY (registration_id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (participant_id);


--
-- Name: qr_code_passes qr_code_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.qr_code_passes
    ADD CONSTRAINT qr_code_passes_pkey PRIMARY KEY (qr_id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (referral_id);


--
-- Name: refresh_sessions refresh_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_pkey PRIMARY KEY (refresh_session_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (shift_id);


--
-- Name: staff_assignments staff_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT staff_assignments_pkey PRIMARY KEY (staff_assignment_id);


--
-- Name: station_templates station_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.station_templates
    ADD CONSTRAINT station_templates_pkey PRIMARY KEY (station_template_id);


--
-- Name: sync_actions sync_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.sync_actions
    ADD CONSTRAINT sync_actions_pkey PRIMARY KEY (sync_action_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: document_artifacts_generated_by_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX document_artifacts_generated_by_user_id_idx ON public.document_artifacts USING btree (generated_by_user_id);


--
-- Name: document_artifacts_referral_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX document_artifacts_referral_id_idx ON public.document_artifacts USING btree (referral_id);


--
-- Name: document_artifacts_review_id_document_type_version_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX document_artifacts_review_id_document_type_version_key ON public.document_artifacts USING btree (review_id, document_type, version);


--
-- Name: event_audit_logs_actor_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_audit_logs_actor_user_id_created_at_idx ON public.event_audit_logs USING btree (actor_user_id, created_at);


--
-- Name: event_audit_logs_correlation_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_audit_logs_correlation_id_idx ON public.event_audit_logs USING btree (correlation_id);


--
-- Name: event_audit_logs_event_id_created_at_event_audit_log_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_audit_logs_event_id_created_at_event_audit_log_id_idx ON public.event_audit_logs USING btree (event_id, created_at, event_audit_log_id);


--
-- Name: event_days_event_id_date_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX event_days_event_id_date_key ON public.event_days USING btree (event_id, date);


--
-- Name: event_days_event_id_starts_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_days_event_id_starts_at_idx ON public.event_days USING btree (event_id, starts_at);


--
-- Name: event_registrations_event_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_registrations_event_id_created_at_idx ON public.event_registrations USING btree (event_id, created_at);


--
-- Name: event_registrations_event_id_status_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_registrations_event_id_status_idx ON public.event_registrations USING btree (event_id, status);


--
-- Name: event_station_availabilities_day_available_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_station_availabilities_day_available_idx ON public.event_station_availabilities USING btree (event_day_id, is_available);


--
-- Name: event_station_availabilities_station_day_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX event_station_availabilities_station_day_key ON public.event_station_availabilities USING btree (event_station_id, event_day_id);


--
-- Name: event_stations_event_id_is_available_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX event_stations_event_id_is_available_idx ON public.event_stations USING btree (event_id, is_available);


--
-- Name: event_stations_event_id_station_order_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX event_stations_event_id_station_order_key ON public.event_stations USING btree (event_id, station_order);


--
-- Name: event_stations_event_id_station_template_id_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX event_stations_event_id_station_template_id_key ON public.event_stations USING btree (event_id, station_template_id);


--
-- Name: events_created_by_user_id_create_idempotency_key_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX events_created_by_user_id_create_idempotency_key_key ON public.events USING btree (created_by_user_id, create_idempotency_key);


--
-- Name: events_created_by_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX events_created_by_user_id_idx ON public.events USING btree (created_by_user_id);


--
-- Name: events_status_starts_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX events_status_starts_at_idx ON public.events USING btree (status, starts_at);


--
-- Name: notification_deliveries_document_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX notification_deliveries_document_id_idx ON public.notification_deliveries USING btree (document_id);


--
-- Name: notification_deliveries_idempotency_key_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX notification_deliveries_idempotency_key_key ON public.notification_deliveries USING btree (idempotency_key);


--
-- Name: notification_deliveries_referral_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX notification_deliveries_referral_id_idx ON public.notification_deliveries USING btree (referral_id);


--
-- Name: notification_deliveries_status_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX notification_deliveries_status_created_at_idx ON public.notification_deliveries USING btree (status, created_at);


--
-- Name: participant_event_registrations_event_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX participant_event_registrations_event_id_created_at_idx ON public.participant_event_registrations USING btree (event_id, created_at);


--
-- Name: participant_event_registrations_participant_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX participant_event_registrations_participant_id_created_at_idx ON public.participant_event_registrations USING btree (participant_id, created_at);


--
-- Name: qr_code_passes_expires_at_is_active_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX qr_code_passes_expires_at_is_active_idx ON public.qr_code_passes USING btree (expires_at, is_active);


--
-- Name: qr_code_passes_registration_id_is_active_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX qr_code_passes_registration_id_is_active_idx ON public.qr_code_passes USING btree (registration_id, is_active);


--
-- Name: qr_code_passes_token_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX qr_code_passes_token_key ON public.qr_code_passes USING btree (token);


--
-- Name: referrals_created_by_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX referrals_created_by_user_id_idx ON public.referrals USING btree (created_by_user_id);


--
-- Name: referrals_registration_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX referrals_registration_id_created_at_idx ON public.referrals USING btree (registration_id, created_at);


--
-- Name: referrals_review_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX referrals_review_id_idx ON public.referrals USING btree (review_id);


--
-- Name: referrals_status_urgency_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX referrals_status_urgency_idx ON public.referrals USING btree (status, urgency);


--
-- Name: refresh_sessions_expires_at_revoked_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX refresh_sessions_expires_at_revoked_at_idx ON public.refresh_sessions USING btree (expires_at, revoked_at);


--
-- Name: refresh_sessions_family_id_created_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX refresh_sessions_family_id_created_at_idx ON public.refresh_sessions USING btree (family_id, created_at);


--
-- Name: refresh_sessions_replaced_by_session_id_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX refresh_sessions_replaced_by_session_id_key ON public.refresh_sessions USING btree (replaced_by_session_id);


--
-- Name: refresh_sessions_token_hash_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX refresh_sessions_token_hash_key ON public.refresh_sessions USING btree (token_hash);


--
-- Name: refresh_sessions_user_id_expires_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX refresh_sessions_user_id_expires_at_idx ON public.refresh_sessions USING btree (user_id, expires_at);


--
-- Name: reviews_outcome_urgency_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX reviews_outcome_urgency_idx ON public.reviews USING btree (outcome, urgency);


--
-- Name: reviews_registration_id_reviewed_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX reviews_registration_id_reviewed_at_idx ON public.reviews USING btree (registration_id, reviewed_at);


--
-- Name: reviews_registration_id_version_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX reviews_registration_id_version_key ON public.reviews USING btree (registration_id, version);


--
-- Name: reviews_reviewed_by_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX reviews_reviewed_by_user_id_idx ON public.reviews USING btree (reviewed_by_user_id);


--
-- Name: reviews_supersedes_review_id_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX reviews_supersedes_review_id_key ON public.reviews USING btree (supersedes_review_id);


--
-- Name: shifts_event_id_name_starts_at_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX shifts_event_id_name_starts_at_key ON public.shifts USING btree (event_id, name, starts_at);


--
-- Name: shifts_event_id_starts_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX shifts_event_id_starts_at_idx ON public.shifts USING btree (event_id, starts_at);


--
-- Name: staff_assignments_assigned_by_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX staff_assignments_assigned_by_user_id_idx ON public.staff_assignments USING btree (assigned_by_user_id);


--
-- Name: staff_assignments_event_station_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX staff_assignments_event_station_id_idx ON public.staff_assignments USING btree (event_station_id);


--
-- Name: staff_assignments_shift_id_user_id_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX staff_assignments_shift_id_user_id_key ON public.staff_assignments USING btree (shift_id, user_id);


--
-- Name: staff_assignments_user_id_status_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX staff_assignments_user_id_status_idx ON public.staff_assignments USING btree (user_id, status);


--
-- Name: station_templates_active_name_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX station_templates_active_name_idx ON public.station_templates USING btree (active, name);


--
-- Name: station_templates_template_key_version_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX station_templates_template_key_version_key ON public.station_templates USING btree (template_key, version);


--
-- Name: sync_actions_actor_user_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX sync_actions_actor_user_id_idx ON public.sync_actions USING btree (actor_user_id);


--
-- Name: sync_actions_device_id_sync_action_id_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX sync_actions_device_id_sync_action_id_key ON public.sync_actions USING btree (device_id, sync_action_id);


--
-- Name: sync_actions_entity_type_entity_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX sync_actions_entity_type_entity_id_idx ON public.sync_actions USING btree (entity_type, entity_id);


--
-- Name: sync_actions_registration_id_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX sync_actions_registration_id_idx ON public.sync_actions USING btree (registration_id);


--
-- Name: sync_actions_status_received_at_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX sync_actions_status_received_at_idx ON public.sync_actions USING btree (status, received_at);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: users_status_locked_until_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX users_status_locked_until_idx ON public.users USING btree (status, locked_until);


--
-- Name: users_system_role_status_idx; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE INDEX users_system_role_status_idx ON public.users USING btree (system_role, status);


--
-- Name: users_username_key; Type: INDEX; Schema: public; Owner: vsms_app
--

CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username);


--
-- Name: event_audit_logs event_audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: vsms_app
--

CREATE TRIGGER event_audit_logs_append_only BEFORE DELETE OR UPDATE ON public.event_audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_event_audit_mutation();


--
-- Name: document_artifacts document_artifacts_generated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.document_artifacts
    ADD CONSTRAINT document_artifacts_generated_by_user_id_fkey FOREIGN KEY (generated_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: document_artifacts document_artifacts_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.document_artifacts
    ADD CONSTRAINT document_artifacts_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(referral_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: document_artifacts document_artifacts_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.document_artifacts
    ADD CONSTRAINT document_artifacts_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(review_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: event_audit_logs event_audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_audit_logs
    ADD CONSTRAINT event_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: event_audit_logs event_audit_logs_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_audit_logs
    ADD CONSTRAINT event_audit_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: event_days event_days_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_days
    ADD CONSTRAINT event_days_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_registrations event_registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_station_availabilities event_station_availabilities_day_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_station_availabilities
    ADD CONSTRAINT event_station_availabilities_day_fkey FOREIGN KEY (event_day_id) REFERENCES public.event_days(event_day_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_station_availabilities event_station_availabilities_station_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_station_availabilities
    ADD CONSTRAINT event_station_availabilities_station_fkey FOREIGN KEY (event_station_id) REFERENCES public.event_stations(event_station_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_stations event_stations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_stations
    ADD CONSTRAINT event_stations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_stations event_stations_station_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.event_stations
    ADD CONSTRAINT event_stations_station_template_id_fkey FOREIGN KEY (station_template_id) REFERENCES public.station_templates(station_template_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: events events_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: events events_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: notification_deliveries notification_deliveries_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.document_artifacts(document_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: notification_deliveries notification_deliveries_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(referral_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: participant_event_registrations participant_event_registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.participant_event_registrations
    ADD CONSTRAINT participant_event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: participant_event_registrations participant_event_registrations_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.participant_event_registrations
    ADD CONSTRAINT participant_event_registrations_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(participant_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: qr_code_passes qr_code_passes_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.qr_code_passes
    ADD CONSTRAINT qr_code_passes_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.participant_event_registrations(registration_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: qr_code_passes qr_code_passes_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.qr_code_passes
    ADD CONSTRAINT qr_code_passes_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: referrals referrals_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: referrals referrals_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(review_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: refresh_sessions refresh_sessions_replaced_by_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_replaced_by_session_id_fkey FOREIGN KEY (replaced_by_session_id) REFERENCES public.refresh_sessions(refresh_session_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refresh_sessions refresh_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reviews reviews_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: reviews reviews_supersedes_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_supersedes_review_id_fkey FOREIGN KEY (supersedes_review_id) REFERENCES public.reviews(review_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: shifts shifts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: staff_assignments staff_assignments_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT staff_assignments_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: staff_assignments staff_assignments_event_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT staff_assignments_event_station_id_fkey FOREIGN KEY (event_station_id) REFERENCES public.event_stations(event_station_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: staff_assignments staff_assignments_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT staff_assignments_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(shift_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: staff_assignments staff_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.staff_assignments
    ADD CONSTRAINT staff_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sync_actions sync_actions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: vsms_app
--

ALTER TABLE ONLY public.sync_actions
    ADD CONSTRAINT sync_actions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict NccOvwHfteJdxHfKlzxNgcSYNKizs8G9d4obdIQEn5FghhCTRdpfyvJFVvGX7AZ
