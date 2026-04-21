export function buildAppUrl(path: string, request: Request) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredBaseUrl) {
    return new URL(path, configuredBaseUrl);
  }

  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (forwardedHost) {
    const protocol = forwardedProto ?? requestUrl.protocol.replace(":", "");
    return new URL(path, `${protocol}://${forwardedHost}`);
  }

  return new URL(path, request.url);
}
