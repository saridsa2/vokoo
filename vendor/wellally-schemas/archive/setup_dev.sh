#!/bin/bash
# WellAlly Archive - Quick Setup Script
# Install all archive projects in development mode

set -e  # Exit on error

ARCHIVE_DIR="/Users/zhangsan/kxb-website/open-wellally/archive"
cd "$ARCHIVE_DIR"

echo "=================================================="
echo " WellAlly Archive - Development Setup"
echo "=================================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Projects array
projects=(
    "wellally-lab-parser"
    "wellally-healthkit-mapper"
    "wellally-unit-normalizer"
    "wellally-pdf-medical-parser"
    "wellally-medical-timeline"
    "wellally-anomaly-flagger"
    "wellally-trend-detector"
    "wellally-data-correlation"
    "wellally-report-structurer-ai"
    "wellally-fhir-lite"
    "wellally-consent-model"
    "wellally-health-audit-log"
    "wellally-health-data-anonymizer"
    "wellally-radiation-dose-calc"
)

# Check if wellally core package is installed
echo "📦 Checking wellally core package..."
if python -c "import wellally" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} wellally core package is installed"
else
    echo -e "${YELLOW}⚠${NC}  wellally core package not found"
    echo "   Installing from ../language/python..."
    (cd ../language/python && pip install -e . -q)
    echo -e "${GREEN}✓${NC} wellally core package installed"
fi
echo ""

# Install each project
installed=0
failed=0

for project in "${projects[@]}"; do
    echo "📁 $project"
    project_dir="$project/language/python"

    if [ ! -d "$project_dir" ]; then
        echo -e "   ${RED}✗${NC} Directory not found"
        ((failed++))
        continue
    fi

    if [ ! -f "$project_dir/pyproject.toml" ]; then
        echo -e "   ${RED}✗${NC} pyproject.toml not found"
        ((failed++))
        continue
    fi

    # Install in development mode
    if (cd "$project_dir" && pip install -e . -q 2>&1); then
        echo -e "   ${GREEN}✓${NC} Installed successfully"
        ((installed++))
    else
        echo -e "   ${RED}✗${NC} Installation failed"
        ((failed++))
    fi
    echo ""
done

echo "=================================================="
echo " Installation Summary"
echo "=================================================="
echo -e "${GREEN}✓${NC} Installed: $installed"
if [ $failed -gt 0 ]; then
    echo -e "${RED}✗${NC} Failed: $failed"
fi
echo "📦 Total: ${#projects[@]}"
echo ""

# Test imports
echo "🧪 Testing imports..."
echo ""

test_passed=0
test_failed=0

# Test completed projects
echo "Testing completed projects:"
if python -c "from wellally_lab_parser import LabReportParser" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} wellally_lab_parser"
    ((test_passed++))
else
    echo -e "  ${RED}✗${NC} wellally_lab_parser"
    ((test_failed++))
fi

if python -c "from wellally_healthkit_mapper import HealthKitMapper" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} wellally_healthkit_mapper"
    ((test_passed++))
else
    echo -e "  ${RED}✗${NC} wellally_healthkit_mapper"
    ((test_failed++))
fi

echo ""
echo "Testing in-progress projects:"
if python -c "from wellally_unit_normalizer import UnitNormalizer" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} wellally_unit_normalizer"
    ((test_passed++))
else
    echo -e "  ${YELLOW}⚠${NC}  wellally_unit_normalizer (implementation pending)"
fi

echo ""
echo "=================================================="
echo " Test Summary"
echo "=================================================="
echo -e "${GREEN}✓${NC} Passed: $test_passed"
if [ $test_failed -gt 0 ]; then
    echo -e "${RED}✗${NC} Failed: $test_failed"
fi
echo ""

echo "✨ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "  1. Review implementation: python PROJECT_STATUS.py"
echo "  2. Run examples:"
echo "     cd wellally-lab-parser/language/python && python examples.py"
echo "     cd wellally-healthkit-mapper/language/python && python examples.py"
echo "  3. Check documentation in each project's README.md"
echo ""
