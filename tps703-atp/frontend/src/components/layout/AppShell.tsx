import { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthContext } from '@/contexts/AuthContext'
import type { AuthState } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Settings2,
  Play,
  ClipboardList,
  Zap,
  Activity,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  LogOut,
  FileText,
  Waves,
  BookOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logoImg from '@/assets/logo.png'

const navItems: {
  path: string
  label: string
  icon: LucideIcon
  minRole?: 'admin' | 'engineer' | 'technician' | 'viewer'
}[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/test-setup', label: 'Test Setup', icon: Settings2 },
  { path: '/test-execution', label: 'Test Execution', icon: Play },
  { path: '/results', label: 'Results', icon: ClipboardList },
  { path: '/atp-author', label: 'ATP Author', icon: FileText, minRole: 'engineer' },
  { path: '/sparam', label: 'S-Parameters', icon: Waves, minRole: 'technician' },
  { path: '/equipment', label: 'Test Equipment', icon: Zap, minRole: 'technician' },
  { path: '/instrument-bench', label: 'Instrument Bench', icon: Activity, minRole: 'technician' },
  { path: '/admin', label: 'Admin', icon: ShieldCheck, minRole: 'admin' },
]

const roleColors: Record<string, string> = {
  admin: 'bg-red-500',
  engineer: 'bg-blue-500',
  technician: 'bg-emerald-500',
  viewer: 'bg-slate-500',
}

const ROLE_HIERARCHY = ['viewer', 'technician', 'engineer', 'admin']

function hasMinRole(userRole: string, minRole: string): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(minRole)
}

interface AppShellProps {
  children: ReactNode
  auth: AuthState
  onLogout: () => void
}

export default function AppShell({ children, auth, onLogout }: AppShellProps) {
  const location = useLocation()
  const user = auth.user
  const [collapsed, setCollapsed] = useState(false)

  return (
    <AuthContext value={auth}>
      <TooltipProvider delayDuration={0}>
        <div className="flex h-screen bg-background">
          {/* Sidebar */}
          <aside
            className={cn(
              'bg-card border-r border-border flex flex-col shrink-0 transition-[width] duration-200',
              collapsed ? 'w-16' : 'w-64',
            )}
          >
            {/* Header / Branding */}
            <div
              className={cn(
                'flex items-center border-b border-border',
                collapsed ? 'p-3 justify-center' : 'px-4 py-4 justify-between',
              )}
            >
              {!collapsed ? (
                <div className="flex items-center gap-3">
                  <img src={logoImg} alt="TPS-703" className="h-9 w-9 rounded-lg object-contain" />
                  <div>
                    <h1 className="text-sm font-bold tracking-wide text-foreground">TPS-703 ATP</h1>
                    <p className="text-[11px] leading-tight text-muted-foreground">Acceptance Test System</p>
                  </div>
                </div>
              ) : (
                <img src={logoImg} alt="TPS-703" className="h-9 w-9 rounded-lg object-contain" />
              )}
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setCollapsed(c => !c)}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Collapse sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
            </div>

            {collapsed && (
              <div className="flex justify-center pt-2 pb-1">
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Expand sidebar"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Navigation */}
            <nav className={cn('flex-1 py-3', collapsed ? 'px-2' : 'px-3')}>
              <div className="flex flex-col gap-1">
                {navItems
                  .filter(item => !item.minRole || (user && hasMinRole(user.role, item.minRole)))
                  .map(item => {
                    // Find the most specific (longest) matching nav path so that
                    // e.g. /equipment/bench highlights "Equipment Bench" but not "Test Equipment".
                    const bestMatchPath = navItems
                      .filter(i => location.pathname === i.path || location.pathname.startsWith(i.path + '/'))
                      .reduce((best, candidate) => (candidate.path.length > best.length ? candidate.path : best), '')
                    const isActive = bestMatchPath === item.path
                    const Icon = item.icon

                    const linkContent = (
                      <Link to={item.path} className="block">
                        <div
                          className={cn(
                            'group relative flex items-center rounded-lg transition-colors',
                            collapsed ? 'justify-center h-10 w-full' : 'gap-3 px-3 h-10',
                            isActive
                              ? 'bg-blue-600/10 text-blue-600'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-blue-600" />
                          )}
                          <Icon className="h-[18px] w-[18px] shrink-0" />
                          {!collapsed && (
                            <span className="text-sm font-medium">{item.label}</span>
                          )}
                        </div>
                      </Link>
                    )

                    if (collapsed) {
                      return (
                        <Tooltip key={item.path}>
                          <TooltipTrigger
                            render={(triggerProps) => (
                              <Link
                                {...triggerProps}
                                to={item.path}
                                className="block w-full"
                              >
                                <div
                                  className={cn(
                                    'group relative flex items-center justify-center h-10 w-full rounded-lg transition-colors',
                                    isActive
                                      ? 'bg-blue-600/10 text-blue-600'
                                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                  )}
                                >
                                  {isActive && (
                                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-blue-600" />
                                  )}
                                  <Icon className="h-[18px] w-[18px] shrink-0" />
                                </div>
                              </Link>
                            )}
                          />
                          <TooltipContent side="right" sideOffset={8}>
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return <div key={item.path}>{linkContent}</div>
                  })}
              </div>
            </nav>

            <Separator />

            {/* User info */}
            <div className={cn(collapsed ? 'p-2' : 'p-3')}>
              {user && (
                collapsed ? (
                  <div className="flex flex-col items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-default',
                            roleColors[user.role],
                          )}
                        >
                          {user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        <div className="text-xs">
                          <p className="font-medium">{user.full_name}</p>
                          <p className="text-muted-foreground capitalize">{user.role}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={onLogout}
                          className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-red-500 hover:bg-accent transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        Sign Out
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0',
                          roleColors[user.role],
                        )}
                      >
                        {user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{user.full_name}</p>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1.5 capitalize"
                          >
                            {user.role}
                          </Badge>
                          {user.badge_id && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {user.badge_id}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-muted-foreground hover:text-red-500 h-8"
                      onClick={onLogout}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                )
              )}
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-auto bg-background">
            <div className="p-6">{children}</div>
          </main>

          {/* Floating "Test Guide" button — fixed top-right of viewport,
              opens the Phase 10 + 11 feature test guide in a new tab.
              Visible on every authenticated page; hover tooltip explains it. */}
          <Tooltip>
            <TooltipTrigger
              render={(triggerProps) => (
                <a
                  {...triggerProps}
                  href="/features.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fixed top-3 right-4 z-50 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium bg-card text-foreground border border-border shadow-sm hover:border-blue-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Test Guide
                </a>
              )}
            />
            <TooltipContent side="bottom" sideOffset={8} className="max-w-xs text-xs">
              <div className="font-medium mb-1">Feature test guide</div>
              <div className="opacity-80">
                Opens a checklist of every Phase 10 + Phase 11 feature
                with step-by-step instructions to verify each one works.
                Useful for QA reviews and demos.
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </AuthContext>
  )
}
