"use client";
import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "@/lib/firebase";

export type ConnectionState = "connecting" | "online" | "offline";

/** Live connection state to the Realtime Database server (via /.info/connected). */
export function useConnection(): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  useEffect(() => {
    let everConnected = false;
    // The first "false" is normal while the socket opens; only call it offline after a grace period.
    const grace = setTimeout(() => !everConnected && setState("offline"), 4000);
    const unsub = onValue(ref(db(), ".info/connected"), (snap) => {
      if (snap.val() === true) {
        everConnected = true;
        setState("online");
      } else if (everConnected) {
        setState("offline");
      }
    });
    return () => {
      clearTimeout(grace);
      unsub();
    };
  }, []);
  return state;
}
