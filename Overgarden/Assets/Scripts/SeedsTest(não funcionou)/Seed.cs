using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "New Seed", menuName = "Item/Seed")]
public class Seed : ScriptableObject
{
    public string itemName = "New Seed";
    public string description;
    public Sprite artwork;
    public int points;
    public int growthTime;
    public int deathTime;

}