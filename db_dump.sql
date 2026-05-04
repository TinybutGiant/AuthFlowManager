--
-- PostgreSQL database dump
--

\restrict vfrNVsiDSBhmBby7k6FBrdpoL1L4Ip2qSLnmTrOJUOirkMfKbkoByubm38ugobZ

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: admin_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.admin_role AS ENUM (
    'super_admin',
    'admin_finance',
    'admin_verifier',
    'admin_support'
);


ALTER TYPE public.admin_role OWNER TO postgres;

--
-- Name: admin_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.admin_status AS ENUM (
    'pending',
    'active',
    'inactive',
    'rejected'
);


ALTER TYPE public.admin_status OWNER TO postgres;

--
-- Name: bill_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.bill_status AS ENUM (
    'unpaid',
    'paid',
    'refunded',
    'uploaded',
    'void',
    'pending',
    'succeeded',
    'rejected',
    'failed',
    'partial_refunded',
    'cancelled'
);


ALTER TYPE public.bill_status OWNER TO postgres;

--
-- Name: bill_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.bill_type AS ENUM (
    'deposit',
    'final_payment',
    'overtime',
    'adjustment',
    'full_payment',
    'extension'
);


ALTER TYPE public.bill_type OWNER TO postgres;

--
-- Name: payment_txn_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.payment_txn_status AS ENUM (
    'pending',
    'succeeded',
    'rejected',
    'failed',
    'partial_refunded',
    'cancelled'
);


ALTER TYPE public.payment_txn_status OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_user_approvals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_user_approvals (
    id integer NOT NULL,
    target_admin_id integer NOT NULL,
    action character varying(50) NOT NULL,
    requested_by integer NOT NULL,
    approved_by integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    request_data jsonb,
    created_at timestamp without time zone DEFAULT now(),
    approved_at timestamp without time zone,
    notes text
);


ALTER TABLE public.admin_user_approvals OWNER TO postgres;

--
-- Name: admin_user_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admin_user_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_user_approvals_id_seq OWNER TO postgres;

--
-- Name: admin_user_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admin_user_approvals_id_seq OWNED BY public.admin_user_approvals.id;


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    name text NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    role public.admin_role NOT NULL,
    status public.admin_status DEFAULT 'pending'::public.admin_status NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_login_at timestamp without time zone,
    permissions text[]
);


ALTER TABLE public.admin_users OWNER TO postgres;

--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_users_id_seq OWNER TO postgres;

--
-- Name: admin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;


--
-- Name: bill_payment_mappings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bill_payment_mappings (
    payment_id integer NOT NULL,
    bill_id integer NOT NULL,
    allocated_amount_cents integer NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_bill_payment_mappings_allocated_positive CHECK ((allocated_amount_cents > 0))
);


ALTER TABLE public.bill_payment_mappings OWNER TO postgres;

--
-- Name: booking_bills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_bills (
    id integer NOT NULL,
    booking_id integer NOT NULL,
    extension_id integer,
    bill_type public.bill_type NOT NULL,
    amount_cents integer NOT NULL,
    status public.bill_status DEFAULT 'unpaid'::public.bill_status NOT NULL,
    method text DEFAULT 'stripe'::text NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_booking_bills_amount_positive CHECK ((amount_cents > 0)),
    CONSTRAINT chk_booking_bills_extension_payment CHECK (((bill_type <> ALL (ARRAY['extension'::public.bill_type, 'overtime'::public.bill_type])) OR (extension_id IS NOT NULL))),
    CONSTRAINT chk_booking_bills_uploaded_only_final_offline CHECK (((status <> 'uploaded'::public.bill_status) OR ((bill_type = 'final_payment'::public.bill_type) AND (method = 'offline'::text))))
);


ALTER TABLE public.booking_bills OWNER TO postgres;

--
-- Name: booking_bills_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.booking_bills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.booking_bills_id_seq OWNER TO postgres;

--
-- Name: booking_bills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.booking_bills_id_seq OWNED BY public.booking_bills.id;


--
-- Name: booking_payment_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_payment_receipts (
    id integer NOT NULL,
    payment_id integer NOT NULL,
    image_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.booking_payment_receipts OWNER TO postgres;

--
-- Name: booking_payment_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.booking_payment_receipts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.booking_payment_receipts_id_seq OWNER TO postgres;

--
-- Name: booking_payment_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.booking_payment_receipts_id_seq OWNED BY public.booking_payment_receipts.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    stripe_payment_intent_id text NOT NULL,
    total_amount_cents integer NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    status public.payment_txn_status DEFAULT 'pending'::public.payment_txn_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT chk_payments_total_amount_positive CHECK ((total_amount_cents > 0))
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email character varying NOT NULL,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    password_hash text NOT NULL,
    is_active character varying DEFAULT 'true'::character varying NOT NULL,
    last_login_at timestamp without time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: admin_user_approvals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_user_approvals ALTER COLUMN id SET DEFAULT nextval('public.admin_user_approvals_id_seq'::regclass);


--
-- Name: admin_users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);


--
-- Name: booking_bills id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_bills ALTER COLUMN id SET DEFAULT nextval('public.booking_bills_id_seq'::regclass);


--
-- Name: booking_payment_receipts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_payment_receipts ALTER COLUMN id SET DEFAULT nextval('public.booking_payment_receipts_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Data for Name: admin_user_approvals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.admin_user_approvals (id, target_admin_id, action, requested_by, approved_by, status, request_data, created_at, approved_at, notes) FROM stdin;
\.


--
-- Data for Name: admin_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.admin_users (id, name, email, password_hash, role, status, created_by, created_at, updated_at, last_login_at, permissions) FROM stdin;
3	Super Admin	admin@example.com	$2b$12$K6tAv1.nBRkCnvPRnzmyzOOLzHTzusFVYNrJkVxuCxM.KLnwvXFNG	super_admin	active	\N	2025-08-31 02:16:08.566717	2026-02-06 01:14:23.162	2026-02-06 01:14:23.162	\N
\.


--
-- Data for Name: bill_payment_mappings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_payment_mappings (payment_id, bill_id, allocated_amount_cents, currency, created_at) FROM stdin;
\.


--
-- Data for Name: booking_bills; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_bills (id, booking_id, extension_id, bill_type, amount_cents, status, method, currency, created_at) FROM stdin;
\.


--
-- Data for Name: booking_payment_receipts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_payment_receipts (id, payment_id, image_url, uploaded_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, stripe_payment_intent_id, total_amount_cents, currency, status, created_at, expires_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (sid, sess, expire) FROM stdin;
l1djcvNMrUEc8NvWJBgTUQBlJTODHJno	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T02:21:31.443Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "RZQq_e3g17wTq_R0InkM2qxvV67j07MOce08awj6xeQ"}}	2025-09-06 02:21:32
wXArgdoAezFZJPX9qcPS1OqHhAkAvTkn	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T02:21:34.610Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "5I39dPLh015g9ess1xf5z7e6q5M4q_Nj6uCAiicu1mY"}}	2025-09-06 02:21:35
P1L-kUC9xnw_O7TlFJWLaMLvJNf-G6K9	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T02:21:33.331Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "RiO9Y89CIWjjA9Xc40nuNjNikSb6f6Mf9VQG6pbVFMU"}}	2025-09-06 02:21:34
PsfMph8eKHCRtFzce8A_k-aM_QhUrVxj	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:40:16.032Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "mfqdD-Q4dR5WQt8IjvQLPuwzTxepBHblNJ3Tx4V0RZI"}}	2025-09-06 16:40:17
dGtQyU856OgcRSYS4nrRYMsQTA0SxPJn	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:40:23.579Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "cWS43q8Oi87nTrNxitplU7loMBD3KYaliFVpGFbzaEg"}}	2025-09-06 16:40:24
BdVAmcblPUHKjZg-zJIrB_vPe5cXmb5W	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:40:34.131Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "7Gxbeei9Xut_NW4HwVqS-pXY8_Hcb1H4uMuuBoXZP_k"}}	2025-09-06 16:40:35
XhFOLQHNEf16WsnGweo-jNmrMwOoEz2a	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:40:52.434Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "TbCS7NHmtlod0tZf3iCaNoeghuxgHM1HYydoR8Zvvvg"}}	2025-09-06 16:40:53
_7MWyNmQCP3POImKQFG_Jw7h9VKREION	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:41:06.609Z", "httpOnly": true, "originalMaxAge": 604800000}, "replit.com": {"code_verifier": "VYfIS_ae564PIgueRo2cKDdcTo4XnHbQbPbJd7Q2sUw"}}	2025-09-06 16:41:07
GG3Z6QQ-oX7LPFMlzsj5uk32muQ0UVBN	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-06T16:41:31.191Z", "httpOnly": true, "originalMaxAge": 604800000}, "passport": {"user": {"claims": {"aud": "11c3aab0-ecf9-480d-9f5e-9bd28661f737", "exp": 1756575690, "iat": 1756572090, "iss": "https://replit.com/oidc", "sub": "41614820", "email": "suzy2ming@gmail.com", "at_hash": "QW6EPZrC_tyucZRIwyxm9Q", "username": "suzy2ming", "auth_time": 1756572089, "last_name": "Liu", "first_name": "Shengyu"}, "expires_at": 1756575690, "access_token": "lkVxqehU2Cw5SnXHAvZWLcsDYnoQTx-lmkG6anZdprJ", "refresh_token": "inTN-08XO0Y--gEB3tgGTr0oPX2o7e0C4E9nmXiignF"}}}	2025-09-06 16:42:17
Cd0g8eJXfmtxMr1LcCuOQFlYlAj8NfnC	{"cookie": {"path": "/", "secure": true, "expires": "2025-09-07T01:25:13.762Z", "httpOnly": true, "originalMaxAge": 604800000}, "passport": {"user": {"claims": {"aud": "11c3aab0-ecf9-480d-9f5e-9bd28661f737", "exp": 1756607113, "iat": 1756603513, "iss": "https://replit.com/oidc", "sub": "41614820", "email": "suzy2ming@gmail.com", "at_hash": "lvq8K0Igvkf0BkRtJD46nw", "username": "suzy2ming", "auth_time": 1756603513, "last_name": "Liu", "first_name": "Shengyu"}, "expires_at": 1756607113, "access_token": "el3UrJ0ZJ_PKz8KPNbWmkY6dDW1mOjxXTeHgiiwZgE-", "refresh_token": "I_LPswu-8YKbnBlrAnqYIvyuB-31w44HtNNX7AgyznH"}}}	2025-09-07 01:47:59
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, first_name, last_name, profile_image_url, created_at, updated_at, password_hash, is_active, last_login_at) FROM stdin;
\.


--
-- Name: admin_user_approvals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.admin_user_approvals_id_seq', 1, true);


--
-- Name: admin_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.admin_users_id_seq', 3, true);


--
-- Name: booking_bills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_bills_id_seq', 1, false);


--
-- Name: booking_payment_receipts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_payment_receipts_id_seq', 1, false);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: admin_user_approvals admin_user_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_user_approvals
    ADD CONSTRAINT admin_user_approvals_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_unique UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: bill_payment_mappings bill_payment_mappings_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payment_mappings
    ADD CONSTRAINT bill_payment_mappings_pk PRIMARY KEY (payment_id, bill_id);


--
-- Name: booking_bills booking_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_bills
    ADD CONSTRAINT booking_bills_pkey PRIMARY KEY (id);


--
-- Name: booking_payment_receipts booking_payment_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_payment_receipts
    ADD CONSTRAINT booking_payment_receipts_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: idx_bill_payment_mappings_bill_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_payment_mappings_bill_id ON public.bill_payment_mappings USING btree (bill_id);


--
-- Name: idx_booking_bills_booking_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_booking_bills_booking_id ON public.booking_bills USING btree (booking_id);


--
-- Name: idx_booking_bills_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_booking_bills_status ON public.booking_bills USING btree (status);


--
-- Name: idx_bpr_payment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bpr_payment ON public.booking_payment_receipts USING btree (payment_id);


--
-- Name: idx_payments_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_created_at ON public.payments USING btree (created_at DESC);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: bill_payment_mappings fk_bill_payment_mappings_bill_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payment_mappings
    ADD CONSTRAINT fk_bill_payment_mappings_bill_id FOREIGN KEY (bill_id) REFERENCES public.booking_bills(id) ON DELETE CASCADE;


--
-- Name: bill_payment_mappings fk_bill_payment_mappings_payment_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payment_mappings
    ADD CONSTRAINT fk_bill_payment_mappings_payment_id FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict vfrNVsiDSBhmBby7k6FBrdpoL1L4Ip2qSLnmTrOJUOirkMfKbkoByubm38ugobZ

