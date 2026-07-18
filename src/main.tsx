import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

if (import.meta.env.DEV) {
  void import("./preview").then(({ demoPosts, demoDetails, demoCommunities }) => {
    root.render(<App demoPosts={demoPosts} demoDetails={demoDetails} demoCommunities={demoCommunities} />);
  });
} else {
  root.render(<App />);
}
