import { Model3DPreview } from "./components/Model3DPreview";
import "./App.css";

const environmentMapUrl =
    typeof import.meta.env.VITE_ENVIRONMENT_MAP_URL === "string" &&
    import.meta.env.VITE_ENVIRONMENT_MAP_URL.trim() !== ""
        ? import.meta.env.VITE_ENVIRONMENT_MAP_URL.trim()
        : undefined;

function App() {
    return (
        <div className="app-container">
            <main className="app-main">
                <Model3DPreview environmentUrl={environmentMapUrl} />
            </main>
        </div>
    );
}

export default App;
