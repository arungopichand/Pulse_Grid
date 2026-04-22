#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "pulsegrid-state";
const prefix = (process.env.SUPABASE_STORAGE_STATE_PREFIX?.trim() || "session-state").replace(
  /^\/+|\/+$/g,
  "",
);

const rawUrls = process.env.LEGACY_BLOB_URLS?.trim() || "";
const urls = rawUrls
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error(
    "Missing Supabase env vars. Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

if (urls.length === 0) {
  console.error("No input URLs found. Set LEGACY_BLOB_URLS as a comma-separated list.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const [index, url] of urls.entries()) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    console.error(`[${index + 1}/${urls.length}] Failed to fetch ${url} (${response.status})`);
    continue;
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`[${index + 1}/${urls.length}] Skipped non-JSON payload at ${url}`);
    continue;
  }

  const stateStoreKey =
    parsed?.stateStoreKey?.toString().trim() ||
    process.env.STATE_STORE_KEY?.trim() ||
    `legacy-${index + 1}`;
  const objectPath = `${prefix}/${stateStoreKey}.json`;

  const { error } = await supabase.storage.from(bucket).upload(objectPath, JSON.stringify(parsed), {
    upsert: true,
    contentType: "application/json",
    cacheControl: "0",
  });

  if (error) {
    console.error(`[${index + 1}/${urls.length}] Upload failed for ${objectPath}: ${error.message}`);
    continue;
  }

  console.log(`[${index + 1}/${urls.length}] Migrated ${url} -> ${bucket}/${objectPath}`);
}
