#!/bin/bash

# Claude Code Skills 安裝腳本
# 用途：快速安裝全域或專案特定 skills

set -e

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Claude Code Skills 安裝程序${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 獲取腳本所在目錄（倉庫根目錄）
REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo -e "${YELLOW}倉庫位置：${NC}$REPO_DIR"
echo ""

# 選擇安裝類型
echo "請選擇安裝類型："
echo "  1) 全域 Skills (所有專案通用)"
echo "  2) Unity 專案 Skills (當前目錄)"
echo "  3) 全域 + Unity Skills (全部安裝)"
echo ""
read -p "請輸入選項 (1/2/3): " choice

case $choice in
    1)
        echo -e "\n${GREEN}安裝全域 Skills...${NC}"

        # 檢查是否已存在
        if [ -e ~/.claude/skills ]; then
            echo -e "${YELLOW}警告：~/.claude/skills 已存在${NC}"
            read -p "是否覆蓋？(y/n): " overwrite
            if [ "$overwrite" != "y" ]; then
                echo -e "${RED}安裝取消${NC}"
                exit 1
            fi
            rm -rf ~/.claude/skills
        fi

        # 創建符號連結
        mkdir -p ~/.claude
        ln -s "$REPO_DIR/global" ~/.claude/skills

        echo -e "${GREEN}✓ 全域 Skills 已安裝到 ~/.claude/skills/${NC}"
        echo -e "${GREEN}✓ 使用符號連結，自動同步更新${NC}"
        ;;

    2)
        echo -e "\n${GREEN}安裝 Unity 專案 Skills...${NC}"

        # 檢查是否在 Unity 專案中
        if [ ! -d "Assets" ]; then
            echo -e "${YELLOW}警告：當前目錄不像是 Unity 專案（沒有 Assets 資料夾）${NC}"
            read -p "是否繼續？(y/n): " continue
            if [ "$continue" != "y" ]; then
                echo -e "${RED}安裝取消${NC}"
                exit 1
            fi
        fi

        # 檢查是否已存在
        if [ -e .claude/skills ]; then
            echo -e "${YELLOW}警告：.claude/skills 已存在${NC}"
            read -p "是否覆蓋？(y/n): " overwrite
            if [ "$overwrite" != "y" ]; then
                echo -e "${RED}安裝取消${NC}"
                exit 1
            fi
            rm -rf .claude/skills
        fi

        # 創建符號連結
        mkdir -p .claude
        ln -s "$REPO_DIR/projects/unity" .claude/skills

        echo -e "${GREEN}✓ Unity Skills 已安裝到 .claude/skills/${NC}"
        echo -e "${GREEN}✓ 使用符號連結，自動同步更新${NC}"
        ;;

    3)
        echo -e "\n${GREEN}安裝全域 + Unity Skills...${NC}"

        # 安裝全域
        if [ -e ~/.claude/skills ]; then
            echo -e "${YELLOW}警告：~/.claude/skills 已存在${NC}"
            read -p "是否覆蓋全域 skills？(y/n): " overwrite_global
            if [ "$overwrite_global" == "y" ]; then
                rm -rf ~/.claude/skills
                mkdir -p ~/.claude
                ln -s "$REPO_DIR/global" ~/.claude/skills
                echo -e "${GREEN}✓ 全域 Skills 已安裝${NC}"
            else
                echo -e "${YELLOW}跳過全域 skills 安裝${NC}"
            fi
        else
            mkdir -p ~/.claude
            ln -s "$REPO_DIR/global" ~/.claude/skills
            echo -e "${GREEN}✓ 全域 Skills 已安裝${NC}"
        fi

        # 安裝 Unity
        if [ -e .claude/skills ]; then
            echo -e "${YELLOW}警告：.claude/skills 已存在${NC}"
            read -p "是否覆蓋 Unity skills？(y/n): " overwrite_unity
            if [ "$overwrite_unity" == "y" ]; then
                rm -rf .claude/skills
                mkdir -p .claude
                ln -s "$REPO_DIR/projects/unity" .claude/skills
                echo -e "${GREEN}✓ Unity Skills 已安裝${NC}"
            else
                echo -e "${YELLOW}跳過 Unity skills 安裝${NC}"
            fi
        else
            mkdir -p .claude
            ln -s "$REPO_DIR/projects/unity" .claude/skills
            echo -e "${GREEN}✓ Unity Skills 已安裝${NC}"
        fi
        ;;

    *)
        echo -e "${RED}無效的選項${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}安裝完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 驗證安裝
echo -e "${YELLOW}驗證安裝...${NC}"

if [ $choice -eq 1 ] || [ $choice -eq 3 ]; then
    if [ -L ~/.claude/skills ]; then
        echo -e "${GREEN}✓ 全域 skills 符號連結正確${NC}"
        skill_count=$(find ~/.claude/skills -maxdepth 1 -type d ! -name ".*" | wc -l | tr -d ' ')
        echo -e "${GREEN}✓ 找到 $skill_count 個 skills${NC}"
    fi
fi

if [ $choice -eq 2 ] || [ $choice -eq 3 ]; then
    if [ -L .claude/skills ]; then
        echo -e "${GREEN}✓ Unity skills 符號連結正確${NC}"
        skill_count=$(find .claude/skills -maxdepth 1 -type d ! -name ".*" | wc -l | tr -d ' ')
        echo -e "${GREEN}✓ 找到 $skill_count 個 Unity skills${NC}"
    fi
fi

echo ""
echo -e "${BLUE}下一步：${NC}"
echo "  - 重啟 Claude Code"
echo "  - 測試 skills 是否正常工作"
echo "  - 查看 README.md 瞭解使用方法"
echo ""
echo -e "${YELLOW}測試建議：${NC}"
echo '  問 Claude: "getUserById 函數在哪裡？"'
echo '  期望：Claude 會用 Grep 搜尋，而不是猜測'
echo ""

echo -e "${GREEN}享受使用 Claude Code Skills！ 🚀${NC}"
