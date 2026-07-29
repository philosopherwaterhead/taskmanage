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
    const id = context.params.id;
    const body = await context.request.json();

    const title = String(body.title ?? "").trim();
    const type = String(body.type ?? "").trim();
    const genre = String(body.genre ?? "").trim();
    const status = String(body.status ?? "").trim();

    if (!title || !type || !genre || !status) {
      return json(
        {
          error: "title, type, genre and status are required"
        },
        400
      );
    }

    const now = Math.floor(Date.now() / 1000);

    const result = await context.env.DB
      .prepare(`
        UPDATE tasks
        SET
          title = ?,
          type = ?,
          genre = ?,
          status = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        title,
        type,
        genre,
        status,
        now,
        id
      )
      .run();

    if (result.meta.changes === 0) {
      return json({ error: "Task not found" }, 404);
    }

    return json({
      id,
      title,
      type,
      genre,
      status,
      updated_at: now
    });
  } catch (error) {
    console.error("PUT /api/tasks/:id failed:", error);

    if (error instanceof SyntaxError) {
      return json({ error: "Invalid JSON" }, 400);
    }

    return json({ error: "Failed to update task" }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const id = context.params.id;

    const result = await context.env.DB
      .prepare(`
        DELETE FROM tasks
        WHERE id = ?
      `)
      .bind(id)
      .run();

    if (result.meta.changes === 0) {
      return json({ error: "Task not found" }, 404);
    }

    return json({
      success: true,
      id
    });
  } catch (error) {
    console.error("DELETE /api/tasks/:id failed:", error);
    return json({ error: "Failed to delete task" }, 500);
  }
}
