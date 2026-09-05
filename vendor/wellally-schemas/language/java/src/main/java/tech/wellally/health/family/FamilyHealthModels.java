package tech.wellally.health.family;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import tech.wellally.health.common.Common.CodeableConcept;

import java.util.List;

/**
 * Family Health Tree data models.
 *
 * Package: tech.wellally.health
 * Website: https://www.wellally.tech/
 * Schema: https://wellall.health/schemas/family-health/v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class FamilyHealthModels {

    /**
     * Relationship to proband
     */
    public enum RelationToProband {
        @JsonProperty("self") SELF,
        @JsonProperty("mother") MOTHER,
        @JsonProperty("father") FATHER,
        @JsonProperty("sibling") SIBLING,
        @JsonProperty("child") CHILD,
        @JsonProperty("grandparent") GRANDPARENT,
        @JsonProperty("grandchild") GRANDCHILD,
        @JsonProperty("aunt") AUNT,
        @JsonProperty("uncle") UNCLE,
        @JsonProperty("cousin") COUSIN,
        @JsonProperty("other") OTHER
    }

    /**
     * Biological sex
     */
    public enum Sex {
        @JsonProperty("male") MALE,
        @JsonProperty("female") FEMALE,
        @JsonProperty("other") OTHER,
        @JsonProperty("unknown") UNKNOWN
    }

    /**
     * Family member in a health tree.
     */
    public static class FamilyMember {
        /**
         * Member identifier
         */
        private String id;

        /**
         * Relationship to proband
         */
        private RelationToProband relationToProband;

        /**
         * Biological sex
         */
        private Sex sex;

        /**
         * Year of birth
         */
        private Integer birthYear;

        /**
         * Whether deceased
         */
        private Boolean deceased;

        /**
         * Health conditions (SNOMED CT or ICD-10)
         */
        private List<CodeableConcept> conditions;

        public FamilyMember() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public RelationToProband getRelationToProband() { return relationToProband; }
        public void setRelationToProband(RelationToProband relationToProband) { this.relationToProband = relationToProband; }

        public Sex getSex() { return sex; }
        public void setSex(Sex sex) { this.sex = sex; }

        public Integer getBirthYear() { return birthYear; }
        public void setBirthYear(Integer birthYear) { this.birthYear = birthYear; }

        public Boolean getDeceased() { return deceased; }
        public void setDeceased(Boolean deceased) { this.deceased = deceased; }

        public List<CodeableConcept> getConditions() { return conditions; }
        public void setConditions(List<CodeableConcept> conditions) { this.conditions = conditions; }
    }

    /**
     * Family health tree for genetic and hereditary disease tracking.
     */
    public static class FamilyHealthTree {
        /**
         * ID of the proband (main individual)
         */
        private String probandId;

        /**
         * List of family members
         */
        private List<FamilyMember> members;

        public FamilyHealthTree() {}

        public String getProbandId() { return probandId; }
        public void setProbandId(String probandId) { this.probandId = probandId; }

        public List<FamilyMember> getMembers() { return members; }
        public void setMembers(List<FamilyMember> members) { this.members = members; }
    }
}
