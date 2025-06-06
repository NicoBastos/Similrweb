import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Loader2, Camera, Brain, Search } from "lucide-react";

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  estimatedDuration: number; // in milliseconds
}

interface ProgressStepsProps {
  isActive: boolean;
  onComplete?: () => void;
  websiteUrl?: string;
}

const steps: Step[] = [
  {
    id: "screenshot",
    title: "Taking Screenshot",
    description: "Capturing visual appearance of the website",
    icon: <Camera className="w-5 h-5" />,
    estimatedDuration: 8000, // 8 seconds
  },
  {
    id: "embedding",
    title: "Generating CLIP Embedding",
    description: "Converting visual features into AI vectors",
    icon: <Brain className="w-5 h-5" />,
    estimatedDuration: 25000, // 25 seconds
  },
  {
    id: "search",
    title: "Searching Database",
    description: "Finding visually similar websites",
    icon: <Search className="w-5 h-5" />,
    estimatedDuration: 4000, // 4 seconds
  },
];

export function ProgressSteps({ isActive, onComplete, websiteUrl }: ProgressStepsProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isActive) {
      // Reset state when not active
      setCurrentStepIndex(-1);
      setCompletedSteps(new Set());
      return;
    }

    let timeoutId: NodeJS.Timeout;
    let currentIndex = 0;

    const executeStep = () => {
      if (currentIndex < steps.length) {
        setCurrentStepIndex(currentIndex);
        
        timeoutId = setTimeout(() => {
          setCompletedSteps(prev => new Set([...prev, steps[currentIndex].id]));
          currentIndex++;
          
          if (currentIndex < steps.length) {
            // Small delay between steps
            setTimeout(executeStep, 500);
          } else {
            // All steps completed
            setTimeout(() => {
              onComplete?.();
            }, 1000);
          }
        }, steps[currentIndex].estimatedDuration);
      }
    };

    executeStep();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isActive, onComplete]);

  if (!isActive) {
    return null;
  }

  const getHostname = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="text-center mb-6">
          <h3 className="text-lg font-semibold mb-2">
            Analyzing {websiteUrl && getHostname(websiteUrl)}
          </h3>
          <p className="text-sm text-muted-foreground">
            Processing visual similarity analysis...
          </p>
        </div>

        <div className="space-y-4">
          {steps.map((step, index) => {
            const isCompleted = completedSteps.has(step.id);
            const isCurrent = currentStepIndex === index;
            const isPending = index > currentStepIndex;

            return (
              <div
                key={step.id}
                className={`flex items-center space-x-4 p-4 rounded-lg transition-all duration-500 ${
                  isCurrent
                    ? "bg-primary/10 border border-primary/20 shadow-sm animate-pulse"
                    : isCompleted
                    ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800"
                    : "bg-muted/30"
                }`}
              >
                {/* Icon */}
                <div
                  className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isCompleted
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/25"
                      : isCurrent
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : isCurrent ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    step.icon
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h4
                    className={`font-medium transition-colors duration-300 ${
                      isCompleted
                        ? "text-green-700 dark:text-green-300"
                        : isCurrent
                        ? "text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </h4>
                  <p
                    className={`text-sm transition-colors duration-300 ${
                      isCompleted
                        ? "text-green-600 dark:text-green-400"
                        : isCurrent
                        ? "text-primary/80"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Progress indicator */}
                {isCurrent && (
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Overall progress bar */}
        <div className="mt-6">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Progress</span>
            <span>
              {completedSteps.size} of {steps.length} steps completed
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-gradient-to-r from-primary via-primary/90 to-primary/80 h-2 rounded-full transition-all duration-500 ease-out shadow-sm"
              style={{
                width: `${(completedSteps.size / steps.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 