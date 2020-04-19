using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "New Seed", menuName = "Inventory/Seed")]
public class Seeds : ScriptableObject
{
    public string itemName = "New seed";
    public Sprite icon = null;
}