import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_STORAGE_BUCKET = "pulsegrid-state";
const DEFAULT_STORAGE_PREFIX = "session-state";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
}

function createSupabaseClient(key: string): SupabaseClient {
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getStorageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_STORAGE_BUCKET;
}

function getStoragePrefix() {
  const raw = process.env.SUPABASE_STORAGE_STATE_PREFIX?.trim();
  return raw && raw.length > 0 ? raw.replace(/^\/+|\/+$/g, "") : DEFAULT_STORAGE_PREFIX;
}

export function getStateObjectPath(stateStoreKey: string) {
  const key = stateStoreKey.trim();
  const safeKey = key.length > 0 ? key : "live-session";
  return `${getStoragePrefix()}/${safeKey}.json`;
}

export function hasSupabasePublicEnv() {
  return getSupabaseUrl().length > 0 && getSupabaseAnonKey().length > 0;
}

export function hasSupabaseAdminEnv() {
  return hasSupabasePublicEnv() && getSupabaseServiceRoleKey().length > 0;
}

export function getSupabaseStorageBucket() {
  return getStorageBucket();
}

export async function uploadJsonToSupabaseStorage(
  objectPath: string,
  payload: unknown,
): Promise<void> {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!hasSupabaseAdminEnv()) {
    throw new Error("Supabase admin credentials are missing.");
  }

  const client = createSupabaseClient(serviceRoleKey);
  const { error } = await client.storage
    .from(getStorageBucket())
    .upload(objectPath, JSON.stringify(payload), {
      upsert: true,
      contentType: "application/json",
      cacheControl: "0",
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }
}

export async function readJsonFromSupabaseStorage<T>(
  objectPath: string,
): Promise<T | null> {
  const key = hasSupabaseAdminEnv()
    ? getSupabaseServiceRoleKey()
    : hasSupabasePublicEnv()
      ? getSupabaseAnonKey()
      : "";

  if (!key) {
    throw new Error("Supabase credentials are missing.");
  }

  const client = createSupabaseClient(key);
  const { data, error } = await client.storage
    .from(getStorageBucket())
    .download(objectPath);

  if (error) {
    if (error.message.toLowerCase().includes("not found")) {
      return null;
    }
    throw new Error(`Supabase Storage read failed: ${error.message}`);
  }

  if (!data) return null;
  const text = await data.text();
  return JSON.parse(text) as T;
}

export async function deleteFromSupabaseStorage(
  objectPath: string,
): Promise<void> {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!hasSupabaseAdminEnv()) {
    throw new Error("Supabase admin credentials are missing.");
  }

  const client = createSupabaseClient(serviceRoleKey);
  const { error } = await client.storage.from(getStorageBucket()).remove([objectPath]);
  if (error) {
    throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }
}

export async function createSupabaseSignedObjectUrl(
  objectPath: string,
  expiresInSeconds = 300,
): Promise<string> {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!hasSupabaseAdminEnv()) {
    throw new Error("Supabase admin credentials are missing.");
  }

  const client = createSupabaseClient(serviceRoleKey);
  const { data, error } = await client.storage
    .from(getStorageBucket())
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) {
    throw new Error(`Supabase Storage signed URL failed: ${error.message}`);
  }

  return data.signedUrl;
}
