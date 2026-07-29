function unauthorized() {
  return Response.json(
    {
      error: "Unauthorized"
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": "ApiKey"
      }
    }
  );
}

export async function onRequest(context) {
  const configuredKey = context.env.API_KEY;

  if (!configuredKey) {
    console.error("API_KEY secret is not configured");

    return Response.json(
      {
        error: "Server authentication is not configured"
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const suppliedKey = context.request.headers.get("X-API-Key");

  if (!suppliedKey || suppliedKey !== configuredKey) {
    return unauthorized();
  }

  return context.next();
}
