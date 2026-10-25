import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { MotionProvider } from "../../../client/motion";
import { RunningDots } from "../../../client/running-motion";
const n = Number(new URLSearchParams(location.search).get("n") || 12);
createRoot(document.getElementById("root")!).render(
  <MotionProvider>
    <View style={{ flexDirection: "row", flexWrap: "wrap", backgroundColor: "#111", padding: 8 }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ width: 300, height: 110, margin: 6, backgroundColor: "#1c1c1c", borderRadius: 8 }}>
          <RunningDots color="#5b8cff" seed={"card-" + i} radius={8} />
        </View>
      ))}
    </View>
  </MotionProvider>
);
