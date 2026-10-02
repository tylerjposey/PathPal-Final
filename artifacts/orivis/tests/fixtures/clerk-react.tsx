import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type DemoUser = { id: string; fullName: string };
type ClerkListener = (event: { user: DemoUser | null }) => void;

type DemoClerkContextValue = {
  user: DemoUser | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  addListener: (listener: ClerkListener) => () => void;
};

const DEMO_USER: DemoUser = {
  id: 'demo-smoke-user',
  fullName: 'Demo Field Worker',
};

const DemoClerkContext = createContext<DemoClerkContextValue | null>(null);

function useDemoClerk() {
  const context = useContext(DemoClerkContext);
  if (!context) throw new Error('The smoke-test Clerk provider is missing.');
  return context;
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(null);
  const listeners = useRef(new Set<ClerkListener>());
  const signIn = useCallback(() => setUser(DEMO_USER), []);
  const signOut = useCallback(async () => setUser(null), []);
  const addListener = useCallback(
    (listener: ClerkListener) => {
      listeners.current.add(listener);
      listener({ user });
      return () => listeners.current.delete(listener);
    },
    [user],
  );

  return (
    <DemoClerkContext.Provider value={{ user, signIn, signOut, addListener }}>
      {children}
    </DemoClerkContext.Provider>
  );
}

export function useUser() {
  const { user } = useDemoClerk();
  return { isLoaded: true, isSignedIn: !!user, user };
}

export function useClerk() {
  const { addListener, signOut } = useDemoClerk();
  return { addListener, signOut };
}

export function SignIn() {
  const { signIn } = useDemoClerk();
  return (
    <button
      className="button button-primary"
      data-testid="button-demo-session-sign-in"
      onClick={signIn}
      type="button"
    >
      Continue as demo field worker
    </button>
  );
}

export function SignUp() {
  return <p>Sign-up is not part of the production smoke test.</p>;
}