import { useCallback, useState } from "react";
import { explainError } from "../lib/errors.js";

// The lifecycle of one transaction, for the UI:
//   wallet → waiting for the user to sign
//   mining → sent, waiting for a block
//   done / error
export function useTx(onConfirmed) {
  const [state, setState] = useState({ status: "idle" });

  const run = useCallback(
    async (label, send) => {
      setState({ status: "wallet", label });
      try {
        const tx = await send();
        setState({ status: "mining", label, hash: tx.hash });
        const receipt = await tx.wait();
        setState({ status: "done", label, hash: tx.hash, block: receipt.blockNumber });
        onConfirmed?.(receipt);
        return receipt;
      } catch (e) {
        setState({ status: "error", label, message: explainError(e) });
        return null;
      }
    },
    [onConfirmed]
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy = state.status === "wallet" || state.status === "mining";
  return { state, run, reset, busy };
}
