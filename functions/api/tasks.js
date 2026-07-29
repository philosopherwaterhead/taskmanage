function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

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
          sort_order,
          created_at,
          updated_at
        FROM tasks
        ORDER BY
          status ASC,
          type ASC,
          genre ASC,
          sort_order ASC,
          created_at ASC
      `)
      .all();

    return json(result.results);
  } catch (error) {
    console.error("GET /api/tasks failed:", error);

    return json(
      { error: "Failed to load tasks" },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const title = String(body.title ?? "").trim();
    const type = String(body.type ?? "").trim();
    const genre = String(body.genre ?? "").trim();
    const status = String(body.status ?? "").trim();

    if (!title || !type || !genre || !status) {
      return json(
        {
          error:
            "title, type, genre and status are required"
        },
        400
      );
    }

    const id =
      typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : crypto.randomUUID();

    /*
     * 同じ表示グループ内の末尾へ追加する。
     *
     * 既存の最大sort_orderが5なら、新規タスクは6。
     * 同じグループにタスクがなければ0。
     */
    const orderResult = await context.env.DB
      .prepare(`
        SELECT
          COALESCE(MAX(sort_order), -1) + 1
            AS next_sort_order
        FROM tasks
        WHERE status = ?
          AND type = ?
          AND genre = ?
      `)
      .bind(
        status,
        type,
        genre
      )
      .first();

    const sortOrder =
      Number(orderResult?.next_sort_order ?? 0);

    /*
     * 現在のDBではcreated_atとupdated_atを
     * 秒単位で保存しているため、ここも秒単位に統一。
     */
    const now = Math.floor(Date.now() / 1000);

    await context.env.DB
      .prepare(`
        INSERT INTO tasks (
          id,
          title,
          type,
          genre,
          status,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        title,
        type,
        genre,
        status,
        sortOrder,
        now,
        now
      )
      .run();

    return json(
      {
        id,
        title,
        type,
        genre,
        status,
        sort_order: sortOrder,
        created_at: now,
        updated_at: now
      },
      201
    );
  } catch (error) {
    console.error(
      "POST /api/tasks failed:",
      error
    );

    if (error instanceof SyntaxError) {
      return json(
        { error: "Invalid JSON" },
        400
      );
    }

    return json(
      { error: "Failed to create task" },
      500
    );
  }
}
