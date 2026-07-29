export async function onRequestGet(context) {
  try {
    const result = await context.env.DB
      .prepare(`
        SELECT
          id,
          title,
          type,
          genre,
          status,
          created_at,
          updated_at
        FROM tasks
        ORDER BY created_at ASC
      `)
      .all();

    return Response.json(result.results);
  } catch (error) {
    console.error("Failed to load tasks:", error);

    return Response.json(
      {
        error: "Failed to load tasks"
      },
      {
        status: 500
      }
    );
  }
}
