"use client";

import { motion } from "motion/react";
/* Icons from the shim, per the project rule. */
import { Database01 as Database, Workflow as Eye, IconTeam as Shield, PhoneVolume as FileText, LayerGroup as Globe, ShieldCheck as Heart } from "@/components/icons";

export function Features5() {
  /**
   * The six things the platform does.
   *
   * The block shipped a compliance grid — SOC 2 Type II, ISO/IEC 42001, HIPAA.
   * We hold none of those, and a certification badge a product does not have is
   * the one thing on a healthcare page with real legal consequence, so all
   * three are gone rather than reworded.
   */
  const features = [
    {
      icon: Globe,
      title: "Packs, not blank canvases",
      description:
        "A pack holds the care path, the agents that speak it, the skills they use in a conversation and the tools they reach your systems with. You change what your department does differently; we help with that.",
    },
    {
      icon: Eye,
      title: "One agent per path, per patient",
      description:
        "Create the cohort and every patient on it gets their own instance, following their own dates rather than a campaign schedule.",
    },
    {
      icon: FileText,
      title: "Phone, WhatsApp, and your app",
      description:
        "The channel is a provider, not the product. Hindi and English today, settled before the call starts so the ear, the voice and the wording stay in one language throughout.",
    },
    {
      icon: Shield,
      title: "Assigned to your practitioners",
      description:
        "One or more practitioners per cohort. They open it and it is already current — every patient, every answer, everything the agents have done since.",
    },
    {
      icon: Heart,
      title: "Escalates, never advises",
      description:
        "A symptom, a dose question, a patient who sounds unwell — to the number your department names, during the same call, carrying what the patient said.",
    },
    {
      icon: Database,
      title: "Writes back to your systems",
      description:
        "Outcomes arrive as the fields you defined, keyed on the call so a retry cannot create a second record. Nothing is installed beside your HIS.",
    },
  ];

  return (
    <section className="w-full py-12 sm:py-16 md:py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-neutral-950 relative">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(229, 229, 229, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(229, 229, 229, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 0",
          maskImage: `
            repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 100% 100% at 100% 0%, #000 20%, transparent 80%)
          `,
          WebkitMaskImage: `
            repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 100% 100% at 100% 0%, #000 20%, transparent 80%)
          `,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      />
      <div
        className="absolute inset-0 z-0 opacity-0 dark:opacity-100"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(64, 64, 64, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(64, 64, 64, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 0",
          maskImage: `
            repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 100% 100% at 100% 0%, #000 20%, transparent 80%)
          `,
          WebkitMaskImage: `
            repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 100% 100% at 100% 0%, #000 20%, transparent 80%)
          `,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      />
      <div className="max-w-[1400px] mx-auto relative z-10">
        <div className="mb-12 md:mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="text-3xl tracking-tight sm:text-4xl md:text-5xl lg:text-6xl font-normal text-neutral-900 dark:text-white mb-6 max-w-3xl"
          >
            Security, compliance, and control: by design
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-base tracking-tight sm:text-lg text-neutral-600 dark:text-neutral-400 mb-8"
          >
            What the platform does
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4"
          >
            <button className="tracking-tight px-6 sm:px-8 py-2 sm:py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm sm:text-base hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors duration-200 w-full sm:w-auto">
              hello@sarvathra.ai
            </button>
            <button className="tracking-tight px-6 sm:px-8 py-2 sm:py-2.5 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium text-sm sm:text-base border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors duration-200 w-full sm:w-auto">
              See it run on your protocol
            </button>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className={`p-8 md:p-10 bg-white dark:bg-neutral-950
                  ${index !== 5 ? "border-b border-neutral-200 dark:border-neutral-800" : ""}
                  ${index % 2 === 0 && index !== 4 ? "md:border-r" : ""}
                  ${(index + 1) % 3 !== 0 ? "lg:border-r" : ""}
                  ${index < 3 ? "lg:border-b" : ""}
                `}
              >
                <div className="flex justify-center mb-8">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
                    <Icon
                      className="w-full h-full text-neutral-900 dark:text-white"
                      strokeWidth={0.5}
                    />
                  </div>
                </div>

                <h3 className="text-lg tracking-tight sm:text-xl font-semibold text-neutral-900 dark:text-white mb-3">
                  {feature.title}
                </h3>

                <p className="text-sm tracking-tight sm:text-base text-neutral-600 dark:text-neutral-400 leading-normal">
                  {feature.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default Features5;
