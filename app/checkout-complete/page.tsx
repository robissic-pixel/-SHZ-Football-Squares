export default function CheckoutComplete({
  searchParams,
}: {
  searchParams: { board?: string; square?: string; status?: string };
}) {
  return (
    <main style={{ maxWidth: 480, margin: "80px auto", textAlign: "center", fontFamily: "system-ui" }}>
      <h1>Thanks!</h1>
      <p>
        Your payment for square #{searchParams.square} on the{" "}
        {searchParams.board ?? ""} board is being confirmed. This can take a
        few seconds — refresh the board to see it locked in.
      </p>
      <a href="/">Back to the board</a>
    </main>
  );
}
