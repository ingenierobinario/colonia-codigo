const SENSITIVE_FILE =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|sqlite|db)|.*(cookie|credential|secret|token|session|password|passwd)s?[^/]*)$/i;
export const sensitiveFile = (rel: string) => SENSITIVE_FILE.test(rel) || rel.split("/").some((s) => s.startsWith("."));
