import React, { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";

import Login from "./pages/Login.jsx";
import Orders from "./pages/Orders.jsx";
import Print from "./pages/Print.jsx";
import Shipments from "./pages/Shipments.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/orders" replace />} />
          <Route path="orders" element={<Orders />} />
          <Route path="prints/:id" element={<Print />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
