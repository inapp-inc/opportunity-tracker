import { useAuthUser } from "../contexts/AuthUserContext";

export function useCanEdit() {
  const { user } = useAuthUser();
  const r = user?.role;
  return r === "ADMIN" || r === "EDITOR";
}

export function useIsAdmin() {
  const { user } = useAuthUser();
  return user?.role === "ADMIN";
}

export function useIsViewer() {
  const { user } = useAuthUser();
  return user?.role === "VIEWER";
}
