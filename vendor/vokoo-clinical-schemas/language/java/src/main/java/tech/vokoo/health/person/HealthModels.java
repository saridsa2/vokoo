package tech.vokoo.health.person;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import tech.vokoo.health.common.Common.*;

import java.time.LocalDate;
import java.util.List;

/**
 * Personal Health Record data models.
 *
 * Package: tech.vokoo.health
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:health:v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class HealthModels {

    /**
     * Gender type
     */
    public enum Gender {
        @JsonProperty("male") MALE,
        @JsonProperty("female") FEMALE,
        @JsonProperty("other") OTHER,
        @JsonProperty("unknown") UNKNOWN
    }

    /**
     * Clinical summary information.
     */
    public static class ClinicalSummary {
        /**
         * Known conditions/diagnoses (SNOMED CT or ICD-10)
         */
        private List<CodeableConcept> conditions;

        /**
         * Allergy list
         */
        private List<CodeableConcept> allergies;

        /**
         * Blood type (e.g., A+, O-)
         */
        private String bloodType;

        /**
         * Primary care provider ID
         */
        private String primaryCareProvider;

        public ClinicalSummary() {}

        public List<CodeableConcept> getConditions() { return conditions; }
        public void setConditions(List<CodeableConcept> conditions) { this.conditions = conditions; }

        public List<CodeableConcept> getAllergies() { return allergies; }
        public void setAllergies(List<CodeableConcept> allergies) { this.allergies = allergies; }

        public String getBloodType() { return bloodType; }
        public void setBloodType(String bloodType) { this.bloodType = bloodType; }

        public String getPrimaryCareProvider() { return primaryCareProvider; }
        public void setPrimaryCareProvider(String primaryCareProvider) { this.primaryCareProvider = primaryCareProvider; }
    }

    /**
     * Personal health record.
     */
    public static class Person {
        /**
         * Unique person identifier (UUID/ULID)
         */
        private String id;

        /**
         * Resource type (always "Person")
         */
        private String resourceType = "Person";

        /**
         * Person name(s)
         */
        private List<HumanName> name;

        /**
         * Date of birth
         */
        private LocalDate birthDate;

        /**
         * External identifiers (MRN, national ID, etc.)
         */
        private List<Identifier> identifier;

        /**
         * Gender
         */
        private Gender gender;

        /**
         * Contact points (phone, email)
         */
        private List<ContactPoint> telecom;

        /**
         * Address(es)
         */
        private List<Address> address;

        /**
         * Marital status
         */
        private CodeableConcept maritalStatus;

        /**
         * Language preferences (IETF BCP-47 tags)
         */
        private List<String> language;

        /**
         * Clinical summary
         */
        private ClinicalSummary clinicalSummary;

        public Person() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getResourceType() { return resourceType; }
        public void setResourceType(String resourceType) { this.resourceType = resourceType; }

        public List<HumanName> getName() { return name; }
        public void setName(List<HumanName> name) { this.name = name; }

        public LocalDate getBirthDate() { return birthDate; }
        public void setBirthDate(LocalDate birthDate) { this.birthDate = birthDate; }

        public List<Identifier> getIdentifier() { return identifier; }
        public void setIdentifier(List<Identifier> identifier) { this.identifier = identifier; }

        public Gender getGender() { return gender; }
        public void setGender(Gender gender) { this.gender = gender; }

        public List<ContactPoint> getTelecom() { return telecom; }
        public void setTelecom(List<ContactPoint> telecom) { this.telecom = telecom; }

        public List<Address> getAddress() { return address; }
        public void setAddress(List<Address> address) { this.address = address; }

        public CodeableConcept getMaritalStatus() { return maritalStatus; }
        public void setMaritalStatus(CodeableConcept maritalStatus) { this.maritalStatus = maritalStatus; }

        public List<String> getLanguage() { return language; }
        public void setLanguage(List<String> language) { this.language = language; }

        public ClinicalSummary getClinicalSummary() { return clinicalSummary; }
        public void setClinicalSummary(ClinicalSummary clinicalSummary) { this.clinicalSummary = clinicalSummary; }
    }
}
