// Logo dropdown — works with both Clerk and Supabase auth modes

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/hooks/use-auth";
import { isClerkConfigured } from "@/lib/clerk-config";
import { Home } from "lucide-react";
import { useNavigate } from "react-router";

// Static import — ClerkProvider is mounted synchronously at the app root.
import { UserButton } from "@clerk/react";

export function LogoDropdown() {
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleGoHome = () => {
    navigate("/");
  };

  // When authenticated and Clerk is configured, show Clerk's UserButton
  if (isAuthenticated && isClerkConfigured) {
    return <UserButton />;
  }

  // When authenticated without Clerk, or signed out — show dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent transition-colors">
          <img
            src={logo}
            alt="Logo"
            width={32}
            height={32}
            className="rounded-lg"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={handleGoHome} className="cursor-pointer">
          <Home className="mr-2 h-4 w-4" />
          Landing Page
        </DropdownMenuItem>
        {isAuthenticated && (
          <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
            Sign Out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
