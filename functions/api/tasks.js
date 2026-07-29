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
          sort_order_type,
          sort_order_genre,
          created_at,
          updated_at
        FROM tasks
        ORDER BY created_at ASC
      `)
      .all();

    return json(result.results);
  } catch (error) {
    console.error(
      "GET /api/tasks failed:",
      error
    );

    return json(
      { error: "Failed to load tasks" },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const title =
      String(body.title ?? "").trim();

    const type =
      String(body.type ?? "").trim();

    const genre =
      String(body.genre ?? "").trim();

    const status =
      String(body.status ?? "").trim();

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
      typeof body.id === "string" &&
      body.id.trim()
        ? body.id.trim()
        : crypto.randomUUID();

    const typeOrderResult =
      await context.env.DB
        .prepare(`
          SELECT
            COALESCE(
              MAX(sort_order_type),
              -1
            ) + 1 AS next_order
          FROM tasks
          WHERE status = ?
            AND type = ?
        `)
        .bind(status, type)
        .first();

    const genreOrderResult =
      await context.env.DB
        .prepare(`
          SELECT
            COALESCE(
              MAX(sort_order_genre),
              -1
            ) + 1 AS next_order
          FROM tasks
          WHERE status = ?
            AND genre = ?
        `)
        .bind(status, genre)
        .first();

    const sortOrderType = Number(
      typeOrderResult?.next_order ?? 0
    );

    const sortOrderGenre = Number(
      genreOrderResult?.next_order ?? 0
    );

    const now =
      Math.floor(Date.now() / 1000);

    await context.env.DB
      .prepare(`
        INSERT INTO tasks (
          id,
          title,
          type,
          genre,
          status,
          sort_order_type,
          sort_order_genre,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        title,
        type,
        genre,
        status,
        sortOrderType,
        sortOrderGenre,
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
        sort_order_type: sortOrderType,
        sort_order_genre: sortOrderGenre,
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
      {
        error: "Failed to create task"
      },
      500
    );
  }
}
