import {createRoot} from "react-dom/client";
import Workspace from "./pages/Workspace";
import "./styles/globals.css";
import "./styles/copilot.css";
import "./styles/topics.css";

createRoot(document.getElementById("root")!).render(<Workspace/>);
