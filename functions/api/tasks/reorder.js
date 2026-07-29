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
    const mode = String(body.mode ?? "").trim();
    const group = String(body.group ?? "").trim();
    const ids = body.ids;

    if (
      !status ||
      !["type", "genre"].includes(mode) ||
      !group ||
      !Array.isArray(ids) ||
      ids.some(
        id =>
          typeof id !== "string" ||
          !id.trim()
      )
    ) {
      return json(
        {
          error:
            "status, mode, group and ids are required"
        },
        400
      );
    }

    const normalizedIds = ids.map(id => id.trim());
    const uniqueIds = [...new Set(normalizedIds)];

    if (uniqueIds.length !== normalizedIds.length) {
      return json(
        {
          error: "ids must not contain duplicates"
        },
        400
      );
    }

    if (uniqueIds.length === 0) {
      return json({
        success: true,
        updated: 0
      });
    }

    /*
     * SQLの列名はbindできないため、
     * modeをホワイトリストで判定して決める。
     */
    const groupColumn =
      mode === "type" ? "type" : "genre";

    const orderColumn =
      mode === "type"
        ? "sort_order_type"
        : "sort_order_genre";

    const placeholders = uniqueIds
      .map(() => "?")
      .join(", ");

    /*
     * 送られたすべてのタスクが、
     * 同じタブ・同じ表示グループに属するか確認。
     */
    const checkResult = await context.env.DB
      .prepare(`
        SELECT id
        FROM tasks
        WHERE status = ?
          AND ${groupColumn} = ?
          AND id IN (${placeholders})
      `)
      .bind(
        status,
        group,
        ...uniqueIds
      )
      .all();

    if (
      checkResult.results.length !==
      uniqueIds.length
    ) {
      return json(
        {
          error:
            "Some tasks do not belong to the selected group"
        },
        400
      );
    }

    const now = Math.floor(Date.now() / 1000);

    const statements = uniqueIds.map(
      (id, index) =>
        context.env.DB
          .prepare(`
            UPDATE tasks
            SET
              ${orderColumn} = ?,
              updated_at = ?
            WHERE id = ?
              AND status = ?
              AND ${groupColumn} = ?
          `)
          .bind(
            index,
            now,
            id,
            status,
            group
          )
    );

    await context.env.DB.batch(statements);

    return json({
      success: true,
      updated: uniqueIds.length
    });
  } catch (error) {
    console.error(
      "PUT /api/tasks/reorder failed:",
      error
    );

    if (error instanceof SyntaxError) {
      return json(
        { error: "Invalid JSON" },
        400
      );
    }

    return json(
      {
        error: "Failed to reorder tasks"
      },
      500
    );
  }
}
