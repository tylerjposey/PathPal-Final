import { Storage } from "@google-cloud/storage";

export const reportObjectStorage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export function resolveReportStorageLocation(): { bucket: string; prefix: string } {
  const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const rawPrivateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucket || !rawPrivateDir) throw new Error("Private photo storage is not configured.");
  const parts = rawPrivateDir.split("/").filter(Boolean);
  if (parts[0] === bucket) parts.shift();
  return { bucket, prefix: parts.join("/") };
}