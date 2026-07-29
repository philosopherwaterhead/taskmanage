function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPut(context) {
  try {
    const body = await context.request.json();

    const status = String(body.status ?? "").trim();
    const type = String(body.type ?? "").trim();
    const genre = String(body.genre ?? "").trim();
    const ids = body.ids;

    if (
      !status ||
      !type ||
      !genre ||
      !Array.isArray(ids) ||
      ids.some(id => typeof id !== "string" || !id.trim())
    ) {
      return json(
        {
          error: "status, type, genre and ids are required"
        },
        400
      );
    }

    const uniqueIds = [...new Set(ids.map(id => id.trim()))];

    if (uniqueIds.length !== ids.length) {
      return json(
        { error: "ids must not contain duplicates" },
        400
      );
    }

    if (uniqueIds.length === 0) {
      return json({
        success: true,
        updated: 0
      });
    }

    const placeholders = uniqueIds
      .map(() => "?")
      .join(", ");

    const checkResult = await context.env.DB
      .prepare(`
        SELECT id
        FROM tasks
        WHERE status = ?
          AND type = ?
          AND genre = ?
          AND id IN (${placeholders})
      `)
      .bind(
        status,
        type,
        genre,
        ...uniqueIds
      )
      .all();

    if (checkResult.results.length !== uniqueIds.length) {
      return json(
        {
          error: "Some tasks do not belong to the selected group"
        },
        400
      );
    }

    const now = Math.floor(Date.now() / 1000);

    const statements = uniqueIds.map((id, index) =>
      context.env.DB
        .prepare(`
          UPDATE tasks
          SET
            sort_order = ?,
            updated_at = ?
          WHERE id = ?
            AND status = ?
            AND type = ?
            AND genre = ?
        `)
        .bind(
          index,
          now,
          id,
          status,
          type,
          genre
        )
    );

    await context.env.DB.batch(statements);

    return json({
      success: true,
      updated: uniqueIds.length
    });
  } catch (error) {
    console.error("PUT /api/tasks/reorder failed:", error);

    if (error instanceof SyntaxError) {
      return json(
        { error: "Invalid JSON" },
        400
      );
    }

    return json(
      { error: "Failed to reorder tasks" },
      500
    );
  }
}
