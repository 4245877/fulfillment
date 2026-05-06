import React, { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";

import Board from "./pages/Board.jsx";
import Orders from "./pages/Orders.jsx";
import Print from "./pages/Print.jsx";
import Inventory from "./pages/Inventory.jsx";
import Shipments from "./pages/Shipments.jsx";
import Audit from "./pages/Audit.jsx";
import SettingsPage from "./pages/Settings/SettingsPage.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="board" element={<Board />} />
          <Route path="orders" element={<Orders />} />
          <Route path="prints/:id" element={<Print />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}