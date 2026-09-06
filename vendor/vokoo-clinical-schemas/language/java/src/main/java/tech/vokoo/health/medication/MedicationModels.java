package tech.vokoo.health.medication;

import com.fasterxml.jackson.annotation.JsonInclude;
import tech.vokoo.health.common.Common.*;

import java.time.LocalDate;

/**
 * Medication Record data models.
 *
 * Package: tech.vokoo.health
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:medication:v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MedicationModels {

    /**
     * Medication dosage amount.
     */
    public static class Dosage {
        /**
         * Dose amount
         */
        private Double value;

        /**
         * UCUM unit (e.g., mg, mL)
         */
        private String unit;

        public Dosage() {}

        public Dosage(Double value, String unit) {
            this.value = value;
            this.unit = unit;
        }

        public Double getValue() { return value; }
        public void setValue(Double value) { this.value = value; }

        public String getUnit() { return unit; }
        public void setUnit(String unit) { this.unit = unit; }
    }

    /**
     * Medication administration record.
     */
    public static class MedicationRecord {
        /**
         * Unique record identifier
         */
        private String id;

        /**
         * Reference to Person.id
         */
        private String patientId;

        /**
         * Medication code (RxNorm)
         */
        private Coding medication;

        /**
         * Dose amount and unit
         */
        private Dosage dosage;

        /**
         * Administration route (PO, IV, etc.)
         */
        private Route route;

        /**
         * Start date
         */
        private LocalDate startDate;

        /**
         * Medication form (tablet, capsule, etc.)
         */
        private Coding form;

        /**
         * Dosing frequency (QD, BID, TID, etc.)
         */
        private String frequency;

        /**
         * Treatment duration in days
         */
        private Integer durationDays;

        /**
         * End date
         */
        private LocalDate endDate;

        /**
         * Indication for use
         */
        private CodeableConcept indication;

        /**
         * Additional instructions
         */
        private String instructions;

        public MedicationRecord() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getPatientId() { return patientId; }
        public void setPatientId(String patientId) { this.patientId = patientId; }

        public Coding getMedication() { return medication; }
        public void setMedication(Coding medication) { this.medication = medication; }

        public Dosage getDosage() { return dosage; }
        public void setDosage(Dosage dosage) { this.dosage = dosage; }

        public Route getRoute() { return route; }
        public void setRoute(Route route) { this.route = route; }

        public LocalDate getStartDate() { return startDate; }
        public void setStartDate(LocalDate startDate) { this.startDate = startDate; }

        public Coding getForm() { return form; }
        public void setForm(Coding form) { this.form = form; }

        public String getFrequency() { return frequency; }
        public void setFrequency(String frequency) { this.frequency = frequency; }

        public Integer getDurationDays() { return durationDays; }
        public void setDurationDays(Integer durationDays) { this.durationDays = durationDays; }

        public LocalDate getEndDate() { return endDate; }
        public void setEndDate(LocalDate endDate) { this.endDate = endDate; }

        public CodeableConcept getIndication() { return indication; }
        public void setIndication(CodeableConcept indication) { this.indication = indication; }

        public String getInstructions() { return instructions; }
        public void setInstructions(String instructions) { this.instructions = instructions; }
    }
}
