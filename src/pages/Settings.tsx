import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/nativeSession";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { exceedsMaxUploadSize, MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_LABEL } from "@/lib/uploadLimits";
import { ArrowLeft, Camera, Sun, Moon, Monitor, LogOut, User, Bell, Palette, Shield, Image as ImageIcon } from "lucide-react";
import NotificationSettings from "@/components/settings/NotificationSettings";
import PasswordSettings from "@/components/settings/PasswordSettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import AvatarCropDialog from "@/components/settings/AvatarCropDialog";
import { Textarea } from "@/components/ui/textarea";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { stripBioHeadings } from "@/lib/bio";
import { Switch } from "@/components/ui/switch";


const BIO_MAX = 500;
const PRONOUNS_MAX = 30;

// Client-side rate limits (in ms). Note: enforced only locally — a determined
// user could bypass these, but they're enough to stop accidental spam.
const AVATAR_COOLDOWN_MS = 5 * 60 * 1000;
const USERNAME_COOLDOWN_MS = 5 * 60 * 1000;
const BANNER_COOLDOWN_MS = 5 * 60 * 1000;
const BANNER_ASPECT = 2; // 2:1 banner (1.5x taller than the previous 3:1)

type ProfileGradient = { enabled: boolean; from: string; to: string };
const DEFAULT_GRADIENT: ProfileGradient = { enabled: false, from: "#5865F2", to: "#EB459E" };

const parseGradient = (raw: string | null | undefined): ProfileGradient => {
  if (!raw) return DEFAULT_GRADIENT;
  try {
    const g = JSON.parse(raw);
    if (typeof g?.from === "string" && typeof g?.to === "string") {
      return {
        enabled: !!g.enabled,
        from: g.from,
        to: g.to,
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_GRADIENT;
};

const gradientCss = (g: ProfileGradient) =>
  `linear-gradient(0deg, ${g.from}, ${g.to})`;


const useCountdown = (target: number | null) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return 0;
  return Math.max(0, target - now);
};

const formatRemaining = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
};

export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [gradient, setGradient] = useState<ProfileGradient>(DEFAULT_GRADIENT);
  const [savedGradient, setSavedGradient] = useState<ProfileGradient>(DEFAULT_GRADIENT);
  const [savingGradient, setSavingGradient] = useState(false);
  const [bio, setBio] = useState("");
  const [currentBio, setCurrentBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [currentPronouns, setCurrentPronouns] = useState("");
  const [showBioPreview, setShowBioPreview] = useState(false);
  const [savingAbout, setSavingAbout] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropBannerFile, setCropBannerFile] = useState<File | null>(null);

  const [avatarNextAt, setAvatarNextAt] = useState<number | null>(null);
  const [usernameNextAt, setUsernameNextAt] = useState<number | null>(null);
  const [bannerNextAt, setBannerNextAt] = useState<number | null>(null);
  const avatarRemaining = useCountdown(avatarNextAt);
  const usernameRemaining = useCountdown(usernameNextAt);
  const bannerRemaining = useCountdown(bannerNextAt);

  useEffect(() => {
    if (!user) return;
    const a = Number(localStorage.getItem(`rl:avatar:${user.id}`)) || 0;
    const u = Number(localStorage.getItem(`rl:username:${user.id}`)) || 0;
    const b = Number(localStorage.getItem(`rl:banner:${user.id}`)) || 0;
    if (a > Date.now()) setAvatarNextAt(a);
    if (u > Date.now()) setUsernameNextAt(u);
    if (b > Date.now()) setBannerNextAt(b);
  }, [user]);


  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("username, avatar_url, banner_url, banner_gradient, bio, pronouns")
        .eq("id", user.id)
        .single();
      if (data) {
        setCurrentUsername(data.username);
        setUsername(data.username);
        setAvatarUrl(data.avatar_url);
        setBannerUrl((data as any).banner_url ?? null);
        const g = parseGradient((data as any).banner_gradient ?? null);
        setGradient(g);
        setSavedGradient(g);
        setCurrentBio((data as any).bio ?? "");
        setBio((data as any).bio ?? "");
        setCurrentPronouns((data as any).pronouns ?? "");
        setPronouns((data as any).pronouns ?? "");
      }
    };
    fetchProfile();
  }, [user]);


  const uploadProfileImage = async (
    bucket: "avatars" | "banners",
    data: Blob | File,
    contentType: string,
    column: "avatar_url" | "banner_url"
  ) => {
    if (!user) return null;
    if (exceedsMaxUploadSize(data)) {
      throw new Error(`Maximum file size is ${MAX_UPLOAD_SIZE_LABEL}.`);
    }
    const signResponse = await apiFetch('/api/storage/profile-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, contentType, size: data.size }),
    });
    const signedUpload = await signResponse.json() as { path?: string; token?: string; publicUrl?: string; error?: string };
    if (!signResponse.ok || !signedUpload.path || !signedUpload.token || !signedUpload.publicUrl) {
      throw new Error(signedUpload.error || 'Could not prepare the profile image upload.');
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(signedUpload.path, signedUpload.token, data, { contentType, cacheControl: '3600' });
    if (uploadError) throw uploadError;

    const newUrl = signedUpload.publicUrl + `?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ [column]: newUrl } as any)
      .eq("id", user.id);
    if (updateError) throw updateError;

    return newUrl;
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !user) return;

    if (avatarRemaining > 0) {
      toast({
        title: "Please wait",
        description: `You can change your profile picture again in ${formatRemaining(avatarRemaining)}.`,
        variant: "destructive",
      });
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast({ title: `Image must be ${MAX_UPLOAD_SIZE_LABEL} or smaller`, variant: "destructive" });
      return;
    }

    setCropFile(file);
  };

  const handleCroppedUpload = async (blob: Blob) => {
    if (!user) return;
    setCropFile(null);
    setUploadingAvatar(true);
    try {
      const isGif = blob.type === "image/gif";
      const newUrl = await uploadProfileImage(
        "avatars",
        blob,
        isGif ? "image/gif" : "image/jpeg",
        "avatar_url"
      );
      if (newUrl) {
        setAvatarUrl(newUrl);
        const next = Date.now() + AVATAR_COOLDOWN_MS;
        localStorage.setItem(`rl:avatar:${user.id}`, String(next));
        setAvatarNextAt(next);
        toast({ title: "Profile picture updated!" });
      }
    } catch (error: any) {
      toast({ title: "Error uploading avatar", description: error.message, variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleBannerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (bannerInputRef.current) bannerInputRef.current.value = "";
    if (!file || !user) return;

    if (bannerRemaining > 0) {
      toast({
        title: "Please wait",
        description: `You can change your banner again in ${formatRemaining(bannerRemaining)}.`,
        variant: "destructive",
      });
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast({ title: `Image must be ${MAX_UPLOAD_SIZE_LABEL} or smaller`, variant: "destructive" });
      return;
    }

    setCropBannerFile(file);
  };

  const handleCroppedBannerUpload = async (blob: Blob) => {
    if (!user) return;
    setCropBannerFile(null);
    setUploadingBanner(true);
    try {
      const isGif = blob.type === "image/gif";
      const newUrl = await uploadProfileImage(
        "banners",
        blob,
        isGif ? "image/gif" : "image/jpeg",
        "banner_url"
      );
      if (newUrl) {
        setBannerUrl(newUrl);
        const next = Date.now() + BANNER_COOLDOWN_MS;
        localStorage.setItem(`rl:banner:${user.id}`, String(next));
        setBannerNextAt(next);
        toast({ title: "Banner updated!" });
      }
    } catch (error: any) {
      toast({ title: "Error uploading banner", description: error.message, variant: "destructive" });
    } finally {
      setUploadingBanner(false);
    }
  };


  const handleUsernameChange = async () => {
    if (!user || !username.trim() || username === currentUsername) return;

    if (usernameRemaining > 0) {
      toast({
        title: "Please wait",
        description: `You can change your username again in ${formatRemaining(usernameRemaining)}.`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username.trim())
        .neq("id", user.id)
        .maybeSingle();

      if (existingUser) {
        toast({ title: "Username already taken", variant: "destructive" });
        setLoading(false);
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ username: username.trim(), display_name: username.trim() })
        .eq("id", user.id);

      if (error) throw error;

      setCurrentUsername(username.trim());
      const next = Date.now() + USERNAME_COOLDOWN_MS;
      localStorage.setItem(`rl:username:${user.id}`, String(next));
      setUsernameNextAt(next);
      toast({ title: "Username updated!" });
    } catch (error: any) {
      toast({ title: "Error updating username", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAboutSave = async () => {
    if (!user) return;
    const trimmedBio = bio.slice(0, BIO_MAX);
    const trimmedPronouns = pronouns.trim().slice(0, PRONOUNS_MAX);
    setSavingAbout(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ bio: trimmedBio || null, pronouns: trimmedPronouns || null } as any)
        .eq("id", user.id);
      if (error) throw error;
      setCurrentBio(trimmedBio);
      setCurrentPronouns(trimmedPronouns);
      toast({ title: "Profile updated!" });
    } catch (error: any) {
      toast({ title: "Error updating profile", description: error.message, variant: "destructive" });
    } finally {
      setSavingAbout(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="min-h-screen bg-background settings-page">
      <div className="max-w-2xl mx-auto p-3 sm:p-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-4 sm:mb-6 gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Chat
        </Button>

        <h1 className="text-2xl font-bold mb-4 sm:mb-6">Settings</h1>
        <h2 className="sr-only">Account preferences</h2>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-auto">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="h-4 w-4" />
              <span className="hidden sm:inline">Appearance</span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">Notifications</span>
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Account</span>
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Profile Picture
                </CardTitle>
                <CardDescription>Click on your avatar to change it</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <Avatar
                      className={`h-24 w-24 transition-opacity ${
                        avatarRemaining > 0
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer hover:opacity-80"
                      }`}
                      onClick={() => avatarRemaining === 0 && fileInputRef.current?.click()}
                    >
                      <AvatarImage src={avatarUrl || undefined} />
                      <AvatarFallback className="text-2xl">
                        {currentUsername?.[0]?.toUpperCase() || <User className="h-10 w-10" />}
                      </AvatarFallback>
                    </Avatar>
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-full">
                        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarSelect}
                      className="hidden"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>You'll be able to crop and zoom before saving</p>
                    <p>Max file size: {MAX_UPLOAD_SIZE_LABEL}</p>
                    {avatarRemaining > 0 ? (
                      <p className="text-amber-500 mt-1">
                        Available again in {formatRemaining(avatarRemaining)}
                      </p>
                    ) : (
                      <p className="mt-1">Can be changed once every 5 minutes</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" />
                  Profile Banner
                </CardTitle>
                <CardDescription>Shown at the top of your profile</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`relative w-full aspect-[2/1] rounded-lg overflow-hidden border border-border bg-muted transition-opacity ${
                    bannerRemaining > 0 ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-90"
                  }`}
                  onClick={() => bannerRemaining === 0 && bannerInputRef.current?.click()}
                >
                  {bannerUrl && (
                    <img src={bannerUrl} alt="Profile banner image" className="h-full w-full object-cover" />
                  )}
                  {uploadingBanner && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  )}
                  {!bannerUrl && !uploadingBanner && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/80">
                      Click to upload a banner
                    </div>
                  )}
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBannerSelect}
                    className="hidden"
                  />
                </div>
                <div className="text-sm text-muted-foreground mt-3">
                  <p>Recommended ratio 2:1. You'll be able to crop and zoom (GIFs stay animated).</p>
                  <p>Max file size: {MAX_UPLOAD_SIZE_LABEL}</p>
                  {bannerRemaining > 0 ? (
                    <p className="text-amber-500 mt-1">
                      Available again in {formatRemaining(bannerRemaining)}
                    </p>
                  ) : (
                    <p className="mt-1">Can be changed once every 5 minutes</p>
                  )}
                </div>
              </CardContent>
            </Card>



            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Profile Gradient
                </CardTitle>
                <CardDescription>
                  Adds a gradient color to your profile card. Off by default.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Enable gradient</p>
                    <p className="text-xs text-muted-foreground">
                      When off, your profile uses the default background.
                    </p>
                  </div>
                  <Switch
                    checked={gradient.enabled}
                    onCheckedChange={(v) => setGradient((g) => ({ ...g, enabled: v }))}
                  />
                </div>

                <div className={`grid grid-cols-2 gap-3 ${gradient.enabled ? "" : "opacity-50 pointer-events-none"}`}>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">First color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={gradient.from}
                        onChange={(e) => setGradient((g) => ({ ...g, from: e.target.value }))}
                        className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                      />
                      <Input
                        value={gradient.from}
                        onChange={(e) => setGradient((g) => ({ ...g, from: e.target.value }))}
                        className="font-mono text-xs uppercase"
                        maxLength={9}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Second color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={gradient.to}
                        onChange={(e) => setGradient((g) => ({ ...g, to: e.target.value }))}
                        className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                      />
                      <Input
                        value={gradient.to}
                        onChange={(e) => setGradient((g) => ({ ...g, to: e.target.value }))}
                        className="font-mono text-xs uppercase"
                        maxLength={9}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setGradient(savedGradient)}
                    disabled={
                      savingGradient ||
                      JSON.stringify(gradient) === JSON.stringify(savedGradient)
                    }
                  >
                    Reset
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!user) return;
                      setSavingGradient(true);
                      const { error } = await supabase
                        .from("profiles")
                        .update({ banner_gradient: JSON.stringify(gradient) } as any)
                        .eq("id", user.id);
                      setSavingGradient(false);
                      if (error) {
                        toast({
                          title: "Couldn't save gradient",
                          description: error.message,
                          variant: "destructive",
                        });
                      } else {
                        setSavedGradient(gradient);
                        toast({ title: "Gradient saved" });
                      }
                    }}
                    disabled={
                      savingGradient ||
                      JSON.stringify(gradient) === JSON.stringify(savedGradient)
                    }
                  >
                    {savingGradient ? "Saving…" : "Save gradient"}
                  </Button>
                </div>
              </CardContent>
            </Card>



            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Username
                </CardTitle>
                <CardDescription>
                  Changing your username will update how you appear in all conversations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-3">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter new username"
                    className="flex-1"
                  />
                  <Button
                    onClick={handleUsernameChange}
                    disabled={
                      loading ||
                      !username.trim() ||
                      username === currentUsername ||
                      usernameRemaining > 0
                    }
                  >
                    {loading ? "Saving..." : "Save"}
                  </Button>
                </div>
                {usernameRemaining > 0 ? (
                  <p className="text-xs text-amber-500">
                    You can change your username again in {formatRemaining(usernameRemaining)}.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Can be changed once every 5 minutes.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  About
                </CardTitle>
                <CardDescription>
                  Tell others a bit about yourself. Markdown formatting (bold, italics, links, etc.) works just like in chat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Pronouns</label>
                  <Input
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value.slice(0, PRONOUNS_MAX))}
                    placeholder="e.g. she/her, he/him, they/them"
                    maxLength={PRONOUNS_MAX}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {pronouns.length}/{PRONOUNS_MAX}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Bio</label>
                    <button
                      type="button"
                      onClick={() => setShowBioPreview((v) => !v)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showBioPreview ? "Edit" : "Preview"}
                    </button>
                  </div>
                  {showBioPreview ? (
                    <div className="min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm">
                      {bio.trim() ? (
                        <MessageMarkdown content={stripBioHeadings(bio)} />
                      ) : (
                        <p className="text-muted-foreground italic">Nothing to preview yet.</p>
                      )}
                    </div>
                  ) : (
                    <Textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                      placeholder="Write something about yourself..."
                      rows={5}
                      maxLength={BIO_MAX}
                    />
                  )}
                  <p
                    className={`text-xs text-right ${
                      bio.length >= BIO_MAX ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {bio.length}/{BIO_MAX}
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleAboutSave}
                    disabled={
                      savingAbout ||
                      (bio === currentBio && pronouns === currentPronouns)
                    }
                  >
                    {savingAbout ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Theme</CardTitle>
                <CardDescription>Choose your preferred color scheme</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <Button
                        key={option.value}
                        variant={theme === option.value ? "default" : "outline"}
                        onClick={() => setTheme(option.value)}
                        className="flex-1 gap-2"
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="mt-6">
            <NotificationSettings />
          </TabsContent>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-6 mt-6">
            <PasswordSettings />
            <PrivacySettings />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LogOut className="h-5 w-5" />
                  Sign Out
                </CardTitle>
                <CardDescription>Sign out of your account</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AvatarCropDialog
        open={!!cropFile}
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onCropped={handleCroppedUpload}
        title="Crop your profile picture"
      />

      <AvatarCropDialog
        open={!!cropBannerFile}
        file={cropBannerFile}
        onCancel={() => setCropBannerFile(null)}
        onCropped={handleCroppedBannerUpload}
        aspect={BANNER_ASPECT}
        shape="rect"
        title="Crop your banner"
        outputWidth={1500}
      />

    </div>
  );
}
