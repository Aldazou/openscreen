import {
	Clapperboard,
	Crop,
	Download,
	HelpCircle,
	Keyboard,
	MessageSquareText,
	Monitor,
	Mouse,
	Pause,
	Play,
	RotateCcw,
	Search,
	Sparkles,
	Video,
	Volume2,
	X,
} from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

const ACCENT = "#34B27B";

interface StepProps {
	icon: ComponentType<{ className?: string }>;
	title: string;
	children: React.ReactNode;
}

function Step({ icon: Icon, title, children }: StepProps) {
	return (
		<div className="flex gap-3">
			<div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
				<Icon className="h-4 w-4 text-[#34B27B]" />
			</div>
			<div className="space-y-0.5">
				<div className="text-sm font-medium text-slate-200">{title}</div>
				<p className="text-xs leading-relaxed text-slate-400">{children}</p>
			</div>
		</div>
	);
}

function SectionTitle({ index, label }: { index: number; label: string }) {
	return (
		<div className="flex items-center gap-2.5 pt-2">
			<span
				className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-black"
				style={{ backgroundColor: ACCENT }}
			>
				{index}
			</span>
			<h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</h3>
		</div>
	);
}

interface GettingStartedGuideProps {
	/** Custom trigger element. Falls back to a ghost button when omitted. */
	trigger?: React.ReactNode;
}

/**
 * Self-contained "How to use OpenScreen" walkthrough covering the recording HUD,
 * the editor, and export. Surfaced from the editor empty state and the editor
 * header so the core flow is always one click away.
 */
export function GettingStartedGuide({ trigger }: GettingStartedGuideProps = {}) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				{trigger ?? (
					<Button
						variant="ghost"
						size="sm"
						className="gap-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
					>
						<HelpCircle className="h-3.5 w-3.5" />
						How to use OpenScreen
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 border-white/10 bg-[#09090b] p-0 [&>button]:text-slate-400 [&>button:hover]:text-white">
				<DialogHeader className="border-b border-white/10 px-6 py-5">
					<DialogTitle className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
						<img src="./openscreen.png" alt="" aria-hidden="true" className="h-7 w-7 rounded-lg" />
						How to use OpenScreen
					</DialogTitle>
					<DialogDescription className="text-slate-400">
						Record your screen, polish it in the studio, and export. Here's the full flow.
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 space-y-5 overflow-y-auto custom-scrollbar px-6 py-5">
					{/* 1. Record */}
					<SectionTitle index={1} label="Record (the floating toolbar)" />
					<p className="-mt-1 text-xs leading-relaxed text-slate-500">
						OpenScreen opens as a small floating toolbar at the bottom of your screen, not a window.
						Everything starts there. Drag the dotted handle to move it.
					</p>
					<div className="grid gap-3.5 sm:grid-cols-2">
						<Step icon={Monitor} title="Pick a source">
							Click the screen button to choose a specific window or your whole screen. You must
							pick a source before recording can start.
						</Step>
						<Step icon={Volume2} title="Choose audio & camera">
							Toggle system audio, microphone, and webcam (green = on). Hover a toggle to pick the
							exact mic or camera and see a live level meter.
						</Step>
						<Step icon={Mouse} title="Cursor mode (macOS/Windows)">
							Switch between the editable cursor overlay and the system cursor before you record.
						</Step>
						<Step icon={Video} title="Hit record">
							Press the round record button. The first time on macOS, grant Screen Recording &
							Accessibility permissions, then relaunch.
						</Step>
						<Step icon={Pause} title="Pause, restart, cancel">
							While recording you can pause/resume, restart the take, or cancel it entirely.
						</Step>
						<Step icon={Play} title="Stop to edit">
							Press stop and you're dropped straight into the studio with your recording loaded.
						</Step>
					</div>

					{/* 2. Edit */}
					<SectionTitle index={2} label="Edit (the studio)" />
					<p className="-mt-1 text-xs leading-relaxed text-slate-500">
						Open the studio anytime from the clapperboard icon on the toolbar. The right-hand panel
						holds all the controls.
					</p>
					<div className="grid gap-3.5 sm:grid-cols-2">
						<Step icon={Search} title="Zoom">
							Auto-zoom follows your cursor, or add manual zooms with adjustable depth, duration,
							easing, and exact position.
						</Step>
						<Step icon={Sparkles} title="Backgrounds & polish">
							Add wallpapers, solid colors, gradients, or your own image. Tune padding, rounded
							corners, and motion blur.
						</Step>
						<Step icon={Crop} title="Trim, crop & speed">
							Use the timeline to cut, trim, crop, and set per-segment playback speed. Waveform and
							snapping guides make it easier.
						</Step>
						<Step icon={MessageSquareText} title="Annotations & captions">
							Add text, arrows, and image annotations, blur sensitive regions, and generate
							on-device captions for your voiceover.
						</Step>
						<Step icon={Mouse} title="Cursor effects">
							Adjust cursor size, smoothing, click effects, and themes after recording.
						</Step>
						<Step icon={Keyboard} title="Shortcuts">
							Open the keyboard shortcuts help in the panel; shortcuts are customizable.
						</Step>
					</div>

					{/* 3. Export */}
					<SectionTitle index={3} label="Export" />
					<div className="grid gap-3.5 sm:grid-cols-2">
						<Step icon={Download} title="MP4 or GIF">
							Open the export dialog and render to MP4 or GIF in your chosen aspect ratio and
							resolution.
						</Step>
						<Step icon={RotateCcw} title="Save the project">
							Save as an .openscreen project to reopen and keep editing later.
						</Step>
					</div>

					{/* Tips */}
					<div className="rounded-lg border border-white/5 bg-white/5 p-4">
						<div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
							<Sparkles className="h-3.5 w-3.5 text-[#34B27B]" />
							Good to know
						</div>
						<ul className="space-y-1.5 text-xs leading-relaxed text-slate-400">
							<li className="flex gap-2">
								<span className="text-[#34B27B]">•</span>
								<span>
									Press{" "}
									<kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
										Cmd/Ctrl + Shift + O
									</kbd>{" "}
									anytime to toggle the recording toolbar.
								</span>
							</li>
							<li className="flex gap-2">
								<span className="text-[#34B27B]">•</span>
								<span>Recordings are saved automatically to OpenScreen's recordings folder.</span>
							</li>
							<li className="flex gap-2">
								<span className="text-[#34B27B]">•</span>
								<span>
									The <Clapperboard className="inline h-3 w-3" /> icon opens the studio; the{" "}
									<X className="inline h-3 w-3" /> icon quits the app.
								</span>
							</li>
							<li className="flex gap-2">
								<span className="text-[#34B27B]">•</span>
								<span>
									You can also import an existing video or open a saved project from this screen.
								</span>
							</li>
						</ul>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
