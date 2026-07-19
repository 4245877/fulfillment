import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import NotFound from "./pages/NotFound.jsx";
import stateStyles from "./components/SystemState.module.css";

// Code-split every page into its own chunk so a low-power device only
// downloads, parses and executes the page it actually opens — instead of the
// whole app (including the heavy Settings/InfraSection) on first load.
const Board = lazy(() => import("./pages/Board.jsx"));
const Orders = lazy(() => import("./pages/Orders.jsx"));
const Printers = lazy(() => import("./pages/Printers.jsx"));
const Inventory = lazy(() => import("./pages/Inventory.jsx"));
const Shipments = lazy(() => import("./pages/Shipments.jsx"));
const Appeals = lazy(() => import("./pages/Appeals.jsx"));
const ProductReports = lazy(() => import("./pages/ProductReports.jsx"));
const Audit = lazy(() => import("./pages/Audit.jsx"));
const SettingsPage = lazy(() => import("./pages/Settings/SettingsPage.jsx"));

function PageFallback() {
  return (
    <main className={stateStyles.page} aria-live="polite" aria-busy="true">
      <section className={`${stateStyles.card} ${stateStyles.compactCard}`}>
        <span className={stateStyles.spinner} aria-hidden="true" />
        <p className={stateStyles.statusText}>Хвилинку, будь ласка… я вже несу сторінку.</p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="board" element={<Board />} />
          <Route path="orders" element={<Orders />} />
          <Route path="printers" element={<Printers />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="appeals" element={<Appeals />} />
          <Route path="product-reports" element={<ProductReports />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
