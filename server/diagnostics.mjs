// Public health diagnostics must never include raw driver messages, hosts or secrets.
export function healthFailureCode(error) {
  const categories = {
    "28P01": "database_authentication_failed",
    "28000": "database_authentication_failed",
    "3D000": "database_not_found",
    "42P01": "database_table_missing",
    "42501": "database_permission_denied",
    "53300": "database_connection_limit",
    TAROT_STATE_MISSING: "database_state_missing",
    TAROT_STATE_INVALID: "database_state_invalid",
    ENOTFOUND: "database_host_unreachable",
    EAI_AGAIN: "database_host_unreachable",
    ETIMEDOUT: "database_connection_failed",
    ECONNREFUSED: "database_connection_failed",
    ECONNRESET: "database_connection_failed",
    DEPTH_ZERO_SELF_SIGNED_CERT: "database_tls_failed",
    SELF_SIGNED_CERT_IN_CHAIN: "database_tls_failed",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "database_tls_failed",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "database_tls_failed",
    ERR_TLS_CERT_ALTNAME_INVALID: "database_tls_failed",
    CERT_HAS_EXPIRED: "database_tls_failed",
  };
  return Object.hasOwn(categories, error?.code)
    ? categories[error.code] : "storage_unavailable";
}
