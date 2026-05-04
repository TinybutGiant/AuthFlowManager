import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
// How long Radix keeps the toast in the DOM after it has been dismissed.
// Keep this small so "old toast" doesn't appear to persist across pages.
const TOAST_REMOVE_DELAY = 1000

// Default auto-dismiss duration (ms) when caller doesn't set `duration`.
const TOAST_AUTO_DISMISS_DEFAULT = 4000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastDismissTimeouts = new Map<
  string,
  ReturnType<typeof setTimeout>
>()
const toastRemoveTimeouts = new Map<
  string,
  ReturnType<typeof setTimeout>
>()

function clearDismissTimeout(toastId: string) {
  const timeout = toastDismissTimeouts.get(toastId)
  if (timeout) clearTimeout(timeout)
  toastDismissTimeouts.delete(toastId)
}

function clearRemoveTimeout(toastId: string) {
  const timeout = toastRemoveTimeouts.get(toastId)
  if (timeout) clearTimeout(timeout)
  toastRemoveTimeouts.delete(toastId)
}

function clearAllTimeouts() {
  toastDismissTimeouts.forEach((t) => clearTimeout(t))
  toastDismissTimeouts.clear()
  toastRemoveTimeouts.forEach((t) => clearTimeout(t))
  toastRemoveTimeouts.clear()
}

const addToRemoveQueue = (toastId: string) => {
  if (toastRemoveTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastRemoveTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastRemoveTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        clearDismissTimeout(toastId)
        addToRemoveQueue(toastId)

        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId
              ? {
                  ...t,
                  open: false,
                }
              : t
          ),
        }
      }

      // Full clear: this avoids lingering "closed but still rendered" toasts.
      clearAllTimeouts()
      return { ...state, toasts: [] }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        clearAllTimeouts()
        return {
          ...state,
          toasts: [],
        }
      }

      clearDismissTimeout(action.toastId)
      clearRemoveTimeout(action.toastId)

      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()
  const duration =
    typeof props.duration === "number"
      ? props.duration
      : TOAST_AUTO_DISMISS_DEFAULT

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  // Auto-dismiss after `duration` (default: 3~5s).
  // This is the missing piece that prevents "old toast" from lingering.
  const autoDismissTimeout = setTimeout(() => {
    dismiss()
  }, duration)
  toastDismissTimeouts.set(id, autoDismissTimeout)

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => {
      if (toastId === undefined) {
        dispatch({ type: "REMOVE_TOAST" })
        return
      }
      dispatch({ type: "DISMISS_TOAST", toastId })
    },
  }
}

export { useToast, toast }
