-- Reserved system site used by live Trust Console proofs. Hidden from site lists; has no members or releases.
INSERT INTO "sites" ("id", "slug", "name", "is_system") VALUES ('00000000-0000-4000-8000-0000000000aa', 'trust-lab', 'Trust Lab', true) ON CONFLICT DO NOTHING;
