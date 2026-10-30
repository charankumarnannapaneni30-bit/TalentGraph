export function isAllowedClientOrigin(origin, configuredOrigin, nodeEnv) {
  if (!origin || origin === configuredOrigin) return true;
  if (nodeEnv !== "development") return false;

  const configured = new URL(configuredOrigin);
  const request = new URL(origin);
  const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
  return configured.protocol === request.protocol
    && configured.port === request.port
    && loopbackHosts.has(configured.hostname)
    && loopbackHosts.has(request.hostname);
}
