export async function onRequestGet() {
  const tasks = [
    {
      id: "1",
      title: "Android Widget",
      type: "編集",
      genre: "動画",
      status: "inprogress"
    },
    {
      id: "2",
      title: "Cloudflare Worker",
      type: "執筆",
      genre: "物語",
      status: "inprogress"
    }
  ];

  return Response.json(tasks);
}
