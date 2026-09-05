package tech.wellally.health.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDate;
import java.util.List;

/**
 * Common definitions and types for WellAll Health data models.
 *
 * Package: tech.wellally.health
 * Website: https://www.wellally.tech/
 * Schema: https://wellall.health/schemas/common/v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Common {

    /**
     * Represents a coded value from a terminology system.
     */
    public static class Coding {
        /**
         * URI identifying the terminology system (e.g., http://loinc.org)
         */
        private String system;

        /**
         * The code value from the system
         */
        private String code;

        /**
         * Optional human-readable display text
         */
        private String display;

        // Constructors
        public Coding() {}

        public Coding(String system, String code) {
            this.system = system;
            this.code = code;
        }

        public Coding(String system, String code, String display) {
            this.system = system;
            this.code = code;
            this.display = display;
        }

        // Getters and Setters
        public String getSystem() { return system; }
        public void setSystem(String system) { this.system = system; }

        public String getCode() { return code; }
        public void setCode(String code) { this.code = code; }

        public String getDisplay() { return display; }
        public void setDisplay(String display) { this.display = display; }
    }

    /**
     * A concept that may be defined by one or more codes from formal terminologies.
     */
    public static class CodeableConcept {
        /**
         * List of coded values (at least one required)
         */
        private List<Coding> coding;

        /**
         * Optional plain text representation
         */
        private String text;

        // Constructors
        public CodeableConcept() {}

        public CodeableConcept(List<Coding> coding) {
            this.coding = coding;
        }

        // Getters and Setters
        public List<Coding> getCoding() { return coding; }
        public void setCoding(List<Coding> coding) { this.coding = coding; }

        public String getText() { return text; }
        public void setText(String text) { this.text = text; }
    }

    /**
     * A measured or measurable amount with a UCUM unit.
     */
    public static class Quantity {
        /**
         * Numerical value
         */
        private Double value;

        /**
         * UCUM unit string
         */
        private String unit;

        // Constructors
        public Quantity() {}

        public Quantity(Double value, String unit) {
            this.value = value;
            this.unit = unit;
        }

        // Getters and Setters
        public Double getValue() { return value; }
        public void setValue(Double value) { this.value = value; }

        public String getUnit() { return unit; }
        public void setUnit(String unit) { this.unit = unit; }
    }

    /**
     * Reference range for lab test results.
     */
    public static class ReferenceRange {
        /**
         * Lower bound quantity
         */
        private Quantity low;

        /**
         * Upper bound quantity
         */
        private Quantity high;

        /**
         * Optional textual description
         */
        private String text;

        // Constructors
        public ReferenceRange() {}

        // Getters and Setters
        public Quantity getLow() { return low; }
        public void setLow(Quantity low) { this.low = low; }

        public Quantity getHigh() { return high; }
        public void setHigh(Quantity high) { this.high = high; }

        public String getText() { return text; }
        public void setText(String text) { this.text = text; }
    }

    /**
     * An identifier assigned to a resource.
     */
    public static class Identifier {
        /**
         * URI identifying the namespace
         */
        private String system;

        /**
         * The identifier value
         */
        private String value;

        /**
         * Optional coded type
         */
        private CodeableConcept type;

        /**
         * Optional validity period
         */
        private Period period;

        // Constructors
        public Identifier() {}

        public Identifier(String system, String value) {
            this.system = system;
            this.value = value;
        }

        // Getters and Setters
        public String getSystem() { return system; }
        public void setSystem(String system) { this.system = system; }

        public String getValue() { return value; }
        public void setValue(String value) { this.value = value; }

        public CodeableConcept getType() { return type; }
        public void setType(CodeableConcept type) { this.type = type; }

        public Period getPeriod() { return period; }
        public void setPeriod(Period period) { this.period = period; }
    }

    /**
     * Name usage context
     */
    public enum NameUse {
        @JsonProperty("official") OFFICIAL,
        @JsonProperty("usual") USUAL,
        @JsonProperty("nickname") NICKNAME,
        @JsonProperty("anonymous") ANONYMOUS,
        @JsonProperty("old") OLD,
        @JsonProperty("maiden") MAIDEN
    }

    /**
     * A human's name with text, parts and usage information.
     */
    public static class HumanName {
        /**
         * Family/last name
         */
        private String family;

        /**
         * Given/first name(s)
         */
        private List<String> given;

        /**
         * Name usage context
         */
        private NameUse use;

        /**
         * Name prefix(es)
         */
        private List<String> prefix;

        /**
         * Name suffix(es)
         */
        private List<String> suffix;

        // Constructors
        public HumanName() {}

        public HumanName(String family, List<String> given) {
            this.family = family;
            this.given = given;
        }

        // Getters and Setters
        public String getFamily() { return family; }
        public void setFamily(String family) { this.family = family; }

        public List<String> getGiven() { return given; }
        public void setGiven(List<String> given) { this.given = given; }

        public NameUse getUse() { return use; }
        public void setUse(NameUse use) { this.use = use; }

        public List<String> getPrefix() { return prefix; }
        public void setPrefix(List<String> prefix) { this.prefix = prefix; }

        public List<String> getSuffix() { return suffix; }
        public void setSuffix(List<String> suffix) { this.suffix = suffix; }
    }

    /**
     * Contact system type
     */
    public enum ContactSystem {
        @JsonProperty("phone") PHONE,
        @JsonProperty("email") EMAIL
    }

    /**
     * Contact use context
     */
    public enum ContactUse {
        @JsonProperty("home") HOME,
        @JsonProperty("work") WORK,
        @JsonProperty("mobile") MOBILE
    }

    /**
     * Contact details for a person or organization.
     */
    public static class ContactPoint {
        /**
         * phone | email
         */
        private ContactSystem system;

        /**
         * The actual contact point value
         */
        private String value;

        /**
         * home | work | mobile
         */
        private ContactUse use;

        // Constructors
        public ContactPoint() {}

        public ContactPoint(ContactSystem system, String value) {
            this.system = system;
            this.value = value;
        }

        // Getters and Setters
        public ContactSystem getSystem() { return system; }
        public void setSystem(ContactSystem system) { this.system = system; }

        public String getValue() { return value; }
        public void setValue(String value) { this.value = value; }

        public ContactUse getUse() { return use; }
        public void setUse(ContactUse use) { this.use = use; }
    }

    /**
     * An address for a person or organization.
     */
    public static class Address {
        /**
         * Street address lines
         */
        private List<String> line;

        /**
         * City name
         */
        private String city;

        /**
         * State/province
         */
        private String state;

        /**
         * Postal/zip code
         */
        private String postalCode;

        /**
         * Country name
         */
        private String country;

        // Constructors
        public Address() {}

        // Getters and Setters
        public List<String> getLine() { return line; }
        public void setLine(List<String> line) { this.line = line; }

        public String getCity() { return city; }
        public void setCity(String city) { this.city = city; }

        public String getState() { return state; }
        public void setState(String state) { this.state = state; }

        public String getPostalCode() { return postalCode; }
        public void setPostalCode(String postalCode) { this.postalCode = postalCode; }

        public String getCountry() { return country; }
        public void setCountry(String country) { this.country = country; }
    }

    /**
     * A time period defined by start and end dates.
     */
    public static class Period {
        /**
         * Start date
         */
        private LocalDate start;

        /**
         * End date
         */
        private LocalDate end;

        // Constructors
        public Period() {}

        // Getters and Setters
        public LocalDate getStart() { return start; }
        public void setStart(LocalDate start) { this.start = start; }

        public LocalDate getEnd() { return end; }
        public void setEnd(LocalDate end) { this.end = end; }
    }

    /**
     * Imaging modality codes
     */
    public enum ModalityCode {
        CT, MR, US, XR, PT
    }

    /**
     * Imaging modality code (CT, MR, US, XR, PT).
     */
    public static class Modality {
        /**
         * Terminology system URI
         */
        private String system;

        /**
         * Modality code
         */
        private ModalityCode code;

        /**
         * Optional display text
         */
        private String display;

        // Constructors
        public Modality() {}

        public Modality(String system, ModalityCode code) {
            this.system = system;
            this.code = code;
        }

        // Getters and Setters
        public String getSystem() { return system; }
        public void setSystem(String system) { this.system = system; }

        public ModalityCode getCode() { return code; }
        public void setCode(ModalityCode code) { this.code = code; }

        public String getDisplay() { return display; }
        public void setDisplay(String display) { this.display = display; }
    }

    /**
     * Medication administration route.
     */
    public static class Route {
        /**
         * Terminology system URI
         */
        private String system;

        /**
         * Route code (e.g., PO, IV, IM, SC, INH, SL, PR or SNOMED CT codes)
         */
        private String code;

        /**
         * Optional display text
         */
        private String display;

        // Constructors
        public Route() {}

        public Route(String system, String code) {
            this.system = system;
            this.code = code;
        }

        // Getters and Setters
        public String getSystem() { return system; }
        public void setSystem(String system) { this.system = system; }

        public String getCode() { return code; }
        public void setCode(String code) { this.code = code; }

        public String getDisplay() { return display; }
        public void setDisplay(String display) { this.display = display; }
    }
}
