import { useState } from "react";
import { mark, triggerIncident } from "@boe-ventures/agent-replay";
import "./style.css";

const menu = [
  { name: "Night Shift", detail: "Espresso · orange · tonic", price: 62 },
  { name: "Stack Trace", detail: "Filter coffee · cardamom bun", price: 74 },
  { name: "Hot Reload", detail: "Cortado · extra shot", price: 49 },
];

export function App() {
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const placeOrder = async (mode: "broken" | "fixed") => {
    setStatus("Sending order…");
    mark("place-order", { fixture: "CrashCafe", mode, item: menu[selected]!.name });
    const response = await fetch("/mock-api/order.json?api_key=fixture-secret");
    const data = await response.json() as { receipt?: { total?: number }; orderId: string };
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (mode === "broken") {
      triggerIncident("checkout-total-missing");
      const total = data.receipt!.total!.toFixed(2);
      setStatus("Charged " + total);
      return;
    }
    const total = menu[selected]!.price;
    setStatus(`Order ${data.orderId} confirmed · NOK ${total}`);
    mark("order-confirmed", { orderId: data.orderId, total });
  };

  const ordinary404 = async () => {
    const response = await fetch("/mock-api/sold-out.json");
    setStatus("Sold-out lookup returned " + response.status + " (ordinary 404, not incident-pinned)");
  };

  return <main>
    <nav><div className="bean">C</div><b>Crash Café</b><span>LOCAL / OSL</span><em>● REC</em></nav>
    <section className="hero"><div><p>AGENT REPLAY FIXTURE № 02</p><h1>Coffee for humans.<br/><i>Evidence for agents.</i></h1><span>A privacy-safe checkout designed to break the same way, every time.</span></div><div className="cup"><div>CRASH<br/>CAFÉ</div><span/></div></section>
    <section className="order"><div className="menu"><header><h2>Night menu</h2><span>03 items</span></header>{menu.map((item, index) =>
      <button className={selected === index ? "selected" : ""} key={item.name} onClick={() => setSelected(index)}><i>{String(index + 1).padStart(2,"0")}</i><span><b>{item.name}</b><small>{item.detail}</small></span><strong>{item.price},-</strong></button>)}</div>
      <aside><p>YOUR ORDER</p><h2>{menu[selected]!.name}</h2><dl><div><dt>Item</dt><dd>{menu[selected]!.price},-</dd></div><div><dt>Service</dt><dd>0,-</dd></div><div><dt>Total</dt><dd>{menu[selected]!.price},-</dd></div></dl>
        <button className="break" onClick={() => void placeOrder("broken")}>Place broken order</button><button onClick={() => void placeOrder("fixed")}>Place clean order</button><button className="quiet" onClick={() => void ordinary404()}>Check sold-out item (404)</button>
        {status && <output>{status}</output>}</aside></section>
    <footer><span>Session mode · safe privacy</span><code>marker: place-order</code><span>No real payments or customer data</span></footer>
  </main>;
}
